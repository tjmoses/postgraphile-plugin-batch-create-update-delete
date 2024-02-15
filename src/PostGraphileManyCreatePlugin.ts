import * as T from './pluginTypes';
import debugFactory from 'debug';
const debug = debugFactory('graphile-build-pg');

const PostGraphileManyCreatePlugin: T.Plugin = (
  builder: T.SchemaBuilder,
  options: any
) => {
  if (options.pgDisableDefaultMutations) return;

  /**
   * Add a hook to create the new root level create mutation
   */
  builder.hook(
    // @ts-ignore
    'GraphQLObjectType:fields',
    GQLObjectFieldsHookHandlerFcn,
    ['PgMutationManyCreate'], // Hook provides
    [], // Hook before
    ['PgMutationCreate'] // Hook after
  );

  /**
   * Handles adding the new "many create" root level fields
   */
  function GQLObjectFieldsHookHandlerFcn (
    fields: any,
    build: T.Build,
    context: T.Context
  ) {
    const {
      extend,
      newWithHooks,
      parseResolveInfo,
      pgIntrospectionResultsByKind,
      pgGetGqlTypeByTypeIdAndModifier,
      pgGetGqlInputTypeByTypeIdAndModifier,
      pgSql: sql,
      gql2pg,
      graphql: {
        GraphQLObjectType,
        GraphQLInputObjectType,
        GraphQLNonNull,
        GraphQLString,
        GraphQLList
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

    if (!isRootMutation) return fields;

    let newFields: object = {},
      i: number;
    const noOfTables = pgIntrospectionResultsByKind.class.length;
    for (i = 0; i < noOfTables; i++) {
      handleAdditionsFromTableInfo(pgIntrospectionResultsByKind.class[i]);
    }

    function handleAdditionsFromTableInfo (table: T.PgClass) {
      if (
        !table.namespace ||
        !table.isSelectable ||
        !table.isInsertable ||
        omit(table, 'create') ||
        !table.tags.mncud
      )
        return;

      const tableType: T.GraphQLType = pgGetGqlTypeByTypeIdAndModifier(
        table.type.id,
        null
      );

      if (!tableType) {
        debug(
          `There was no table type for table '${table.namespace.name}.${table.name}', so we're not generating a create mutation for it.`
        );
        return;
      }

      const TableInput = pgGetGqlInputTypeByTypeIdAndModifier(
        table.type.id,
        null
      );
      if (!TableInput) {
        debug(
          `There was no input type for table '${table.namespace.name}.${table.name}', so we're going to omit it from the create mutation.`
        );
        return;
      }
      const tableTypeName = inflection.tableType(table);

      // Setup args for the input type
      const newInputHookType = GraphQLInputObjectType;
      const newInputHookSpec = {
        name: `mn${inflection.createInputType(table)}`,
        description: `All input for the create mn\`${tableTypeName}\` mutation.`,
        fields: () => ({
          clientMutationId: {
            description:
              'An arbitrary string value with no semantic meaning. Will be included in the payload verbatim. May be used to track mutations by the client.',
            type: GraphQLString
          },
          [`mn${tableTypeName}`]: {
            description: `The one or many \`${tableTypeName}\` to be created by this mutation.`,
            type: new GraphQLList(new GraphQLNonNull(TableInput))
          }
        })
      };
      const newInputHookScope = {
        __origin: `Adding many table create input type for ${describePgEntity(
          table
        )}.
                   You can rename the table's GraphQL type via a 'Smart Comment':
                   \n\n  ${sqlCommentByAddingTags(table, {
                     name: 'newNameHere'
                   })}`,
        isPgCreateInputType: true,
        pgInflection: table,
        pgIntrospection: table
      };
      const InputType = newWithHooks(
        newInputHookType,
        newInputHookSpec,
        newInputHookScope
      );

      // Setup args for payload type
      const newPayloadHookType = GraphQLObjectType;
      const newPayloadHookSpec = {
        name: `mn${inflection.createPayloadType(table)}`,
        description: `The output of our many create \`${tableTypeName}\` mutation.`,
        fields: ({ fieldWithHooks }: {fieldWithHooks: any}) => {
          const tableName = inflection.tableFieldName(table);
          const tableNamePlural = `${tableName}s`
          return {
            clientMutationId: {
              description:
                'The exact same `clientMutationId` that was provided in the mutation input, unchanged and unused. May be used by a client to track mutations.',
              type: GraphQLString
            },
            [tableNamePlural]: pgField(
              build,
              fieldWithHooks,
              tableNamePlural,
              {
                description: `The \`${tableTypeName}\`s that was created by this mutation.`,
                type: new GraphQLList(tableType)
              },
              {
                isPgCreatePayloadResultField: true,
                pgFieldIntrospection: table
              }
            )
          };
        }
      };
      const newPayloadHookScope = {
        __origin: `Adding many table many create payload type for ${describePgEntity(
          table
        )}.
                   You can rename the table's GraphQL type via a 'Smart Comment':
                   \n\n  ${sqlCommentByAddingTags(table, {
                     name: 'newNameHere'
                   })}\n\nor disable the built-in create mutation via:\n\n  
                    ${sqlCommentByAddingTags(table, { omit: 'create' })}`,
        isMutationPayload: true,
        isPgCreatePayloadType: true,
        pgIntrospection: table
      };
      const PayloadType = newWithHooks(
        newPayloadHookType,
        newPayloadHookSpec,
        newPayloadHookScope
      );

      const fieldName = `mn${inflection.upperCamelCase(
        inflection.createField(table)
      )}`;

      function newFieldWithHooks (): T.FieldWithHooksFunction {
        return fieldWithHooks(
          fieldName,
          (context:any) => {
            context.table = table;
            context.relevantAttributes = table.attributes.filter(
              attr =>
                pgColumnFilter(attr, build, context) && !omit(attr, 'create')
            );
            return {
              description: `Creates one or many \`${tableTypeName}\`.`,
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
            isPgCreateMutationField: true
          }
        );
      }

      async function resolver (_data:any, args:any, resolveContext:any, resolveInfo:any) {
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

        const insertedRowAlias = sql.identifier(Symbol());
        const query = queryFromResolveData(
          insertedRowAlias,
          insertedRowAlias,
          resolveData,
          {},
          null,
          resolveContext,
          resolveInfo.rootValue
        );

        const sqlColumns: T.SQL[] = [];
        const inputData: Object[] =
          input[
            `mn${inflection.upperCamelCase(inflection.tableFieldName(table))}`
          ];
        if (!inputData || inputData.length === 0) return null;
        const sqlValues: T.SQL[][] = Array(inputData.length).fill([]);

        inputData.forEach((dataObj, i) => {
          relevantAttributes.forEach((attr: T.PgAttribute) => {
            const fieldName = inflection.column(attr);
            const dataValue = (dataObj as any)[fieldName];
            // On the first run, store the attribute values
            if (i === 0) {
              sqlColumns.push(sql.identifier(attr.name));
            }
            // If the key exists, store the data else store DEFAULT.
            if (Object.prototype.hasOwnProperty.call(dataObj, fieldName)) {
              sqlValues[i] = [
                ...sqlValues[i],
                gql2pg(dataValue, attr.type, attr.typeModifier)
              ];
            } else {
              sqlValues[i] = [...sqlValues[i], sql.raw('default')];
            }
          });
        });

        const mutationQuery = sql.query`
          INSERT INTO ${sql.identifier(table.namespace.name, table.name)} 
          ${
            sqlColumns.length
              ? sql.fragment`(${sql.join(sqlColumns, ', ')})
            VALUES (${sql.join(
              sqlValues.map(
                dataGroup => sql.fragment`${sql.join(dataGroup, ', ')}`
              ),
              '),('
            )})`
              : sql.fragment`default values`
          } returning *`;
        let rows;
        try {
          await pgClient.query('SAVEPOINT graphql_mutation');
          rows = await viaTemporaryTable(
            pgClient,
            sql.identifier(table.namespace.name, table.name),
            mutationQuery,
            insertedRowAlias,
            query
          );

          await pgClient.query('RELEASE SAVEPOINT graphql_mutation');
        } catch (e) {
          await pgClient.query('ROLLBACK TO SAVEPOINT graphql_mutation');
          throw e;
        }

        return {
          clientMutationId: input.clientMutationId,
          data: rows
        };
      }

      newFields = extend(
        newFields,
        {
          [fieldName]: newFieldWithHooks
        },
        `Adding create mutation for ${describePgEntity(table)}. You can omit
         this default mutation with a 'Smart Comment':\n\n  
         ${sqlCommentByAddingTags(table, {
           omit: 'create'
         })}`
      );
    }

    return extend(
      fields,
      newFields,
      `Adding the many 'create' mutation to the root mutation`
    );
  }
};

export default PostGraphileManyCreatePlugin;
