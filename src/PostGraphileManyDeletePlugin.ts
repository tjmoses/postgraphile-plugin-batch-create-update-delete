import * as T from './pluginTypes';
import debugFactory from 'debug';
const debug = debugFactory('graphile-build-pg');

const PostGraphileManyDeletePlugin: T.Plugin = (
  builder: T.SchemaBuilder,
  options: any
) => {
  if (options.pgDisableDefaultMutations) return;

  /**
   * Add a hook to create the new root level delete mutation
   */
  builder.hook(
    // @ts-ignore
    'GraphQLObjectType:fields',
    GQLObjectFieldsHookHandlerFcn,
    ['PgMutationManyDelete'], // hook provides
    [], // hook before
    ['PgMutationUpdateDelete'] // hook after
  );

  /**
   * Handles adding the new "many delete" root level fields
   */
  function GQLObjectFieldsHookHandlerFcn (
    fields: any,
    build: T.Build,
    context: T.Context
  ) {
    const {
      extend,
      newWithHooks,
      getNodeIdForTypeAndIdentifiers,
      getTypeAndIdentifiersFromNodeId,
      nodeIdFieldName,
      fieldDataGeneratorsByFieldNameByType,
      parseResolveInfo,
      getTypeByName,
      gql2pg,
      pgGetGqlTypeByTypeIdAndModifier,
      pgGetGqlInputTypeByTypeIdAndModifier,
      pgIntrospectionResultsByKind,
      pgSql: sql,
      graphql: {
        GraphQLList,
        GraphQLNonNull,
        GraphQLInputObjectType,
        GraphQLString,
        GraphQLObjectType,
        GraphQLID,
        getNamedType
      },
      pgColumnFilter,
      inflection,
      pgQueryFromResolveData: queryFromResolveData,
      pgOmit: omit,
      pgViaTemporaryTable: viaTemporaryTable,
      describePgEntity,
      sqlCommentByAddingTags,
      pgField
    } = build;
    const {
      scope: { isRootMutation },
      fieldWithHooks
    } = context;

    if (!isRootMutation || !pgColumnFilter) return fields;

    let newFields = {},
      i: number;
    const noOfTables = pgIntrospectionResultsByKind.class.length;
    for (i = 0; i < noOfTables; i++) {
      handleAdditionsFromTableInfo(pgIntrospectionResultsByKind.class[i]);
    }

    function handleAdditionsFromTableInfo (table: T.PgClass) {
      if (
        !table.namespace ||
        !table.isDeletable ||
        omit(table, 'delete') ||
        !table.tags.mncud
      )
        return;

      const tableType: T.GraphQLType = pgGetGqlTypeByTypeIdAndModifier(
        table.type.id,
        null
      );
      if (!tableType) {
        debug(
          `There was no GQL Table Type for table '${table.namespace.name}.${table.name}',
           so we're not generating a many delete mutation for it.`
        );
        return;
      }
      const namedType = getNamedType(tableType);
      const tablePatch = getTypeByName(inflection.patchType(namedType.name));
      if (!tablePatch) {
        throw new Error(
          `Could not find TablePatch type for table '${table.name}'`
        );
      }

      const tableTypeName = namedType.name;
      const uniqueConstraints = table.constraints.filter(
        con => con.type === 'p'
      );

      // Setup and add the GraphQL Payload Type
      const newPayloadHookType = GraphQLObjectType;
      const newPayloadHookSpec = {
        name: `mn${inflection.deletePayloadType(table)}`,
        description: `The output of our delete mn \`${tableTypeName}\` mutation.`,
        fields: ({ fieldWithHooks }) => {
          const tableName = inflection.tableFieldName(table);
          const deletedNodeIdFieldName = inflection.deletedNodeId(table);

          return Object.assign(
            {
              clientMutationId: {
                description:
                  'The exact same `clientMutationId` that was provided in the mutation input, unchanged and unused. May be used by a client to track mutations.',
                type: GraphQLString
              },

              [tableName]: pgField(
                build,
                fieldWithHooks,
                tableName,
                {
                  description: `The \`${tableTypeName}\` that was deleted by this mutation.`,
                  type: tableType
                },
                {},
                false
              )
            },
            {
              [deletedNodeIdFieldName]: fieldWithHooks(
                deletedNodeIdFieldName,
                ({ addDataGenerator }) => {
                  const fieldDataGeneratorsByTableType = fieldDataGeneratorsByFieldNameByType.get(
                    tableType
                  );
                  const gens =
                    fieldDataGeneratorsByTableType &&
                    fieldDataGeneratorsByTableType[nodeIdFieldName];
                  if (gens) {
                    gens.forEach(gen => addDataGenerator(gen));
                  }
                  return {
                    type: GraphQLID,
                    resolve (data) {
                      return (
                        data.data.__identifiers &&
                        getNodeIdForTypeAndIdentifiers(
                          tableType,
                          ...data.data.__identifiers
                        )
                      );
                    }
                  };
                },
                {
                  isPgMutationPayloadDeletedNodeIdField: true
                }
              )
            }
          );
        }
      };
      const newPayloadHookScope = {
        __origin: `Adding table mn delete mutation payload type for ${describePgEntity(
          table
        )}. You can rename the table's GraphQL type via a 'Smart Comment':\n\n  
          ${sqlCommentByAddingTags(table, {
            name: 'newNameHere'
          })}`,
        isMutationPayload: true,
        isPgDeletePayloadType: true,
        pgIntrospection: table
      };
      const PayloadType = newWithHooks(
        newPayloadHookType,
        newPayloadHookSpec,
        newPayloadHookScope
      );
      if (!PayloadType) {
        throw new Error(
          `Failed to determine payload type on the mn\`${tableTypeName}\` mutation`
        );
      }
      // Setup and add GQL Input Types for "Unique Constraint" based updates
      // TODO: Add NodeId code updates
      uniqueConstraints.forEach(constraint => {
        if (omit(constraint, 'delete')) return;
        const keys = constraint.keyAttributes;

        if (!keys.every(_ => _)) {
          throw new Error(
            `Consistency error: could not find an attribute in the constraint when building the many\
             delete mutation for ${describePgEntity(table)}!`
          );
        }
        if (keys.some(key => omit(key, 'read'))) return;

        const fieldName = `mn${inflection.upperCamelCase(
          inflection.deleteByKeys(keys, table, constraint)
        )}`;

        const newInputHookType = GraphQLInputObjectType;

        const patchName = inflection.patchField(
          inflection.tableFieldName(table)
        );

        const newInputHookSpec = {
          name: `mn${inflection.upperCamelCase(
            inflection.deleteByKeysInputType(keys, table, constraint)
          )}`,
          description: `All input for the delete \`${fieldName}\` mutation.`,
          fields: Object.assign(
            {
              clientMutationId: {
                type: GraphQLString
              }
            },
            {
              [`mn${inflection.upperCamelCase(patchName)}`]: {
                description: `The one or many \`${tableTypeName}\` to be deleted. You must provide the PK values!`,
                // TODO: Add an actual type that has the PKs required
                // instead of using the tablePatch in another file,
                // and hook onto the input types to do so.
                //@ts-ignore
                type: new GraphQLList(new GraphQLNonNull(tablePatch!))
              }
            },
            {}
          )
        };

        const newInputHookScope = {
          __origin: `Adding table many delete mutation input type for ${describePgEntity(
            constraint
          )},
                    You can rename the table's GraphQL type via a 'Smart Comment':\n\n
                    ${sqlCommentByAddingTags(table, {
                      name: 'newNameHere'
                    })}`,
          isPgDeleteInputType: true,
          isPgDeleteByKeysInputType: true,
          isMutationInput: true,
          pgInflection: table,
          pgKeys: keys
        };

        const InputType = newWithHooks(
          newInputHookType,
          newInputHookSpec,
          newInputHookScope
        );

        if (!InputType) {
          throw new Error(
            `Failed to determine input type for '${fieldName}' mutation`
          );
        }

        // Define the new mutation field
        function newFieldWithHooks (): T.FieldWithHooksFunction {
          return fieldWithHooks(
            fieldName,
            context => {
              context.table = table;
              context.relevantAttributes = table.attributes.filter(
                attr =>
                  pgColumnFilter(attr, build, context) && !omit(attr, 'delete')
              );
              return {
                description: `Deletes one or many \`${tableTypeName}\` a unique key via a patch.`,
                type: PayloadType,
                args: {
                  input: {
                    type: new GraphQLNonNull(InputType)
                  }
                },
                resolve: resolver.bind(context)
              };
            },
            {
              pgFieldIntrospection: table,
              pgFieldConstraint: constraint,
              isPgNodeMutation: false,
              isPgDeleteMutationField: true
            }
          );
        }

        async function resolver (_data, args, resolveContext, resolveInfo) {
          const { input } = args;
          const {
            table,
            getDataFromParsedResolveInfoFragment,
            relevantAttributes
          }: {
            table: T.PgClass;
            getDataFromParsedResolveInfoFragment: any;
            relevantAttributes: any;
            // @ts-ignore
          } = this;
          const { pgClient } = resolveContext;

          const parsedResolveInfoFragment = parseResolveInfo(resolveInfo);
          // @ts-ignore
          parsedResolveInfoFragment.args = args; // Allow overriding via makeWrapResolversPlugin

          const resolveData = getDataFromParsedResolveInfoFragment(
            parsedResolveInfoFragment,
            PayloadType
          );

          const sqlColumns: T.SQL[] = [];
          const inputData: Object[] =
            input[
              `mn${inflection.upperCamelCase(
                inflection.patchField(inflection.tableFieldName(table))
              )}`
            ];
          if (!inputData || inputData.length === 0) return null;
          const sqlValues: T.SQL[][] = Array(inputData.length).fill([]);
          let hasConstraintValue = true;

          inputData.forEach((dataObj, i) => {
            let setOfRcvdDataHasPKValue = false;
            
            relevantAttributes.forEach((attr: T.PgAttribute) => {
              const fieldName = inflection.column(attr);
              const dataValue = dataObj[fieldName];

              const isConstraintAttr = keys.some(key => key.name === attr.name);
              // Ensure that the field values are PKs since that's
              // all we care about for deletions.
              if (!isConstraintAttr) return;
              // Store all attributes on the first run.
              if (i === 0) {
                sqlColumns.push(sql.raw(attr.name));
              }
              if (fieldName in dataObj) {
                sqlValues[i] = [
                  ...sqlValues[i],
                  gql2pg(dataValue, attr.type, attr.typeModifier)
                ];
                if (isConstraintAttr) {
                  setOfRcvdDataHasPKValue = true;
                }
              }
            });
            if (!setOfRcvdDataHasPKValue) {
              hasConstraintValue = false;
            }
          });

          if (!hasConstraintValue) {
            throw new Error(
              `You must provide the primary key(s) in the provided data for deletes on '${inflection.pluralize(
                inflection._singularizedTableName(table)
              )}'`
            );
          }

          if (sqlColumns.length === 0) return null;

          const mutationQuery = sql.query`\
            DELETE FROM ${sql.identifier(table.namespace.name, table.name)}
            WHERE
              (${sql.join(
                sqlValues.map(
                  (dataGroup, i) =>
                    sql.fragment`(${sql.join(
                      dataGroup.map(
                        (val, j) => sql.fragment`"${sqlColumns[j]}" = ${val}`
                      ),
                      ') and ('
                    )})`
                ),
                ') or ('
              )})
            RETURNING *
          `;

          const modifiedRowAlias = sql.identifier(Symbol());
          const query = queryFromResolveData(
            modifiedRowAlias,
            modifiedRowAlias,
            resolveData,
            {},
            null,
            resolveContext,
            resolveInfo.rootValue
          );

          let row;
          try {
            await pgClient.query('SAVEPOINT graphql_mutation');
            const rows = await viaTemporaryTable(
              pgClient,
              sql.identifier(table.namespace.name, table.name),
              mutationQuery,
              modifiedRowAlias,
              query
            );

            row = rows[0];
            await pgClient.query('RELEASE SAVEPOINT graphql_mutation');
          } catch (e) {
            await pgClient.query('ROLLBACK TO SAVEPOINT graphql_mutation');
            throw e;
          }

          if (!row) {
            throw new Error(
              `No values were deleted in collection '${inflection.pluralize(
                inflection._singularizedTableName(table)
              )}' because no values you can delete were found matching these criteria.`
            );
          }
          return {
            clientMutationId: input.clientMutationId,
            data: row
          };
        }

        newFields = extend(
          newFields,
          {
            [fieldName]: newFieldWithHooks
          },
          `Adding mn delete mutation for ${describePgEntity(constraint)}`
        );
      });
    }

    return extend(
      fields,
      newFields,
      `Adding the many 'delete' mutation to the root mutation`
    );
  }
};
export default PostGraphileManyDeletePlugin;
