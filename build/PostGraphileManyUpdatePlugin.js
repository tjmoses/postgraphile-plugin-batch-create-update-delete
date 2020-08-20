"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug_1 = __importDefault(require("debug"));
const graphql_1 = require("graphql");
const debug = debug_1.default('graphile-build-pg');
const PostGraphileManyUpdatePlugin = (builder, options) => {
    if (options.pgDisableDefaultMutations)
        return;
    /**
     * Add a hook to create the new root level create mutation
     */
    builder.hook(
    // @ts-ignore
    'GraphQLObjectType:fields', GQLObjectFieldsHookHandlerFcn, ['PgMutationManyUpdate'], // hook provides
    [], // hook before
    ['PgMutationUpdateDelete'] // hook after
    );
    /**
     * Handles adding the new "many update" root level fields
     */
    function GQLObjectFieldsHookHandlerFcn(fields, build, context) {
        const { extend, newWithHooks, getNodeIdForTypeAndIdentifiers, getTypeAndIdentifiersFromNodeId, nodeIdFieldName, fieldDataGeneratorsByFieldNameByType, parseResolveInfo, getTypeByName, gql2pg, pgGetGqlTypeByTypeIdAndModifier, pgGetGqlInputTypeByTypeIdAndModifier, pgIntrospectionResultsByKind, pgSql: sql, graphql: { GraphQLNonNull, GraphQLInputObjectType, GraphQLString, GraphQLObjectType, GraphQLID, getNamedType }, pgColumnFilter, inflection, pgQueryFromResolveData: queryFromResolveData, pgOmit: omit, pgViaTemporaryTable: viaTemporaryTable, describePgEntity, sqlCommentByAddingTags, pgField } = build;
        const { scope: { isRootMutation }, fieldWithHooks } = context;
        if (!isRootMutation || !pgColumnFilter)
            return fields;
        let newFields = {}, i;
        const noOfTables = pgIntrospectionResultsByKind.class.length;
        for (i = 0; i < noOfTables; i++) {
            handleAdditionsFromTableInfo(pgIntrospectionResultsByKind.class[i]);
        }
        function handleAdditionsFromTableInfo(table) {
            if (!table.namespace ||
                !table.isUpdatable ||
                omit(table, 'update') ||
                !table.tags.mncud)
                return;
            const tableType = pgGetGqlTypeByTypeIdAndModifier(table.type.id, null);
            if (!tableType) {
                debug(`There was no GQL Table Type for table '${table.namespace.name}.${table.name}',
           so we're not generating a many update mutation for it.`);
                return;
            }
            const namedType = getNamedType(tableType);
            const tablePatch = getTypeByName(inflection.patchType(namedType.name));
            if (!tablePatch) {
                throw new Error(`Could not find TablePatch type for table '${table.name}'`);
            }
            const tableTypeName = namedType.name;
            const uniqueConstraints = table.constraints.filter(con => con.type === 'p');
            // Setup and add the GraphQL Payload type
            const newPayloadHookType = GraphQLObjectType;
            const newPayloadHookSpec = {
                name: `mn${inflection.updatePayloadType(table)}`,
                description: `The output of our update mn \`${tableTypeName}\` mutation.`,
                fields: ({ fieldWithHooks }) => {
                    const tableName = inflection.tableFieldName(table);
                    return {
                        clientMutationId: {
                            description: 'The exact same `clientMutationId` that was provided in the mutation input,\
                 unchanged and unused. May be used by a client to track mutations.',
                            type: GraphQLString
                        },
                        [tableName]: pgField(build, fieldWithHooks, tableName, {
                            description: `The \`${tableTypeName}\` that was updated by this mutation.`,
                            type: tableType
                        }, {}, false)
                    };
                }
            };
            const newPayloadHookScope = {
                __origin: `Adding table many update mutation payload type for ${describePgEntity(table)}.
                   You can rename the table's GraphQL type via a 'Smart Comment':\n\n
                   ${sqlCommentByAddingTags(table, {
                    name: 'newNameHere'
                })}`,
                isMutationPayload: true,
                isPgUpdatePayloadType: true,
                pgIntrospection: table
            };
            const PayloadType = newWithHooks(newPayloadHookType, newPayloadHookSpec, newPayloadHookScope);
            if (!PayloadType) {
                throw new Error(`Failed to determine payload type on the mn\`${tableTypeName}\` mutation`);
            }
            // Setup and add GQL Input Types for "Unique Constraint" based updates
            // TODO: Look into adding updates via NodeId
            uniqueConstraints.forEach(constraint => {
                if (omit(constraint, 'update'))
                    return;
                const keys = constraint.keyAttributes;
                if (!keys.every(_ => _)) {
                    throw new Error(`Consistency error: could not find an attribute in the constraint when building the many\
             update mutation for ${describePgEntity(table)}!`);
                }
                if (keys.some(key => omit(key, 'read')))
                    return;
                const fieldName = `mn${inflection.upperCamelCase(inflection.updateByKeys(keys, table, constraint))}`;
                const newInputHookType = GraphQLInputObjectType;
                const patchName = inflection.patchField(inflection.tableFieldName(table));
                const newInputHookSpec = {
                    name: `mn${inflection.upperCamelCase(inflection.updateByKeysInputType(keys, table, constraint))}`,
                    description: `All input for the update \`${fieldName}\` mutation.`,
                    fields: Object.assign({
                        clientMutationId: {
                            type: GraphQLString
                        }
                    }, {
                        [`mn${inflection.upperCamelCase(patchName)}`]: {
                            description: `The one or many \`${tableTypeName}\` to be updated.`,
                            // TODO: Add an actual type that has the PKs required
                            // instead of using the tablePatch in another file,
                            // and hook onto the input types to do so.
                            //@ts-ignore
                            type: new graphql_1.GraphQLList(new GraphQLNonNull(tablePatch))
                        }
                    }, {})
                };
                const newInputHookScope = {
                    __origin: `Adding table many update mutation input type for ${describePgEntity(constraint)},
                    You can rename the table's GraphQL type via a 'Smart Comment':\n\n
                    ${sqlCommentByAddingTags(table, {
                        name: 'newNameHere'
                    })}`,
                    isPgUpdateInputType: true,
                    isPgUpdateByKeysInputType: true,
                    isMutationInput: true,
                    pgInflection: table,
                    pgKeys: keys
                };
                const InputType = newWithHooks(newInputHookType, newInputHookSpec, newInputHookScope);
                if (!InputType) {
                    throw new Error(`Failed to determine input type for '${fieldName}' mutation`);
                }
                // Define the new mutation field
                function newFieldWithHooks() {
                    return fieldWithHooks(fieldName, context => {
                        context.table = table;
                        context.relevantAttributes = table.attributes.filter(attr => pgColumnFilter(attr, build, context) && !omit(attr, 'update'));
                        return {
                            description: `Updates one or many \`${tableTypeName}\` using a unique key and a patch.`,
                            type: PayloadType,
                            args: {
                                input: {
                                    type: new GraphQLNonNull(InputType)
                                }
                            },
                            resolve: resolver.bind(context)
                        };
                    }, {
                        pgFieldIntrospection: table,
                        pgFieldConstraint: constraint,
                        isPgNodeMutation: false,
                        isPgUpdateMutationField: true
                    });
                }
                async function resolver(_data, args, resolveContext, resolveInfo) {
                    const { input } = args;
                    const { table, getDataFromParsedResolveInfoFragment, relevantAttributes } = this;
                    const { pgClient } = resolveContext;
                    const parsedResolveInfoFragment = parseResolveInfo(resolveInfo);
                    // @ts-ignore
                    parsedResolveInfoFragment.args = args; // Allow overriding via makeWrapResolversPlugin
                    const resolveData = getDataFromParsedResolveInfoFragment(parsedResolveInfoFragment, PayloadType);
                    const sqlColumns = [];
                    const sqlColumnTypes = [];
                    const allSQLColumns = [];
                    const inputData = input[`mn${inflection.upperCamelCase(inflection.patchField(inflection.tableFieldName(table)))}`];
                    const sqlValues = Array(inputData.length).fill([]);
                    const usedSQLColumns = [];
                    const usedColSQLVals = Array(inputData.length).fill([]);
                    let hasConstraintValue = false;
                    inputData.forEach((dataObj, i) => {
                        let setOfRcvdDataHasPKValue = false;
                        relevantAttributes.forEach((attr) => {
                            const fieldName = inflection.column(attr);
                            const dataValue = dataObj[fieldName];
                            const isConstraintAttr = keys.some(key => key.name === attr.name);
                            // Store all attributes on the first run.
                            // Skip the primary keys, since we can't update those.
                            if (i === 0 && !isConstraintAttr) {
                                sqlColumns.push(sql.raw(attr.name));
                                usedSQLColumns.push(sql.raw('use_' + attr.name));
                                sqlColumnTypes.push(sql.raw(attr.type.name));
                            }
                            // Get all of the attributes
                            if (i === 0) {
                                allSQLColumns.push(sql.raw(attr.name));
                            }
                            // Push the data value if it exists, else push
                            // a dummy null value (which will not be used).
                            if (fieldName in dataObj) {
                                sqlValues[i] = [
                                    ...sqlValues[i],
                                    gql2pg(dataValue, attr.type, attr.typeModifier)
                                ];
                                if (!isConstraintAttr) {
                                    usedColSQLVals[i] = [...usedColSQLVals[i], sql.raw('true')];
                                }
                                else {
                                    setOfRcvdDataHasPKValue = true;
                                }
                            }
                            else {
                                sqlValues[i] = [...sqlValues[i], sql.raw('NULL')];
                                if (!isConstraintAttr) {
                                    usedColSQLVals[i] = [...usedColSQLVals[i], sql.raw('false')];
                                }
                            }
                        });
                        if (!setOfRcvdDataHasPKValue) {
                            hasConstraintValue = false;
                        }
                    });
                    if (!hasConstraintValue) {
                        throw new Error(`You must provide the primary key(s) in the updated data for updates on '${inflection.pluralize(inflection._singularizedTableName(table))}'`);
                    }
                    if (sqlColumns.length === 0)
                        return null;
                    // https://stackoverflow.com/questions/63290696/update-multiple-rows-using-postgresql
                    const mutationQuery = sql.query `\ 
          UPDATE ${sql.identifier(table.namespace.name, table.name)} t1 SET
            ${sql.join(sqlColumns.map((col, i) => sql.fragment `${col} = (CASE WHEN t2.use_${col} THEN t2.${col}::${sqlColumnTypes[i]} ELSE t1.${col} END)`), ', ')}
          FROM (VALUES
                (${sql.join(sqlValues.map((dataGroup, i) => sql.fragment `${sql.join(dataGroup.concat(usedColSQLVals[i]), ', ')}`), '),(')})
               ) t2(
                 ${sql.join(allSQLColumns
                        .map(col => sql.fragment `${col}`)
                        .concat(usedSQLColumns.map(useCol => sql.fragment `${useCol}`)), ', ')}
               )
          WHERE ${sql.fragment `(${sql.join(keys.map(key => sql.fragment `t2.${sql.identifier(key.name)}::${sql.raw(key.type.name)} = t1.${sql.identifier(key.name)}`), ') and (')})`}
          RETURNING ${sql.join(allSQLColumns.map(col => sql.fragment `t1.${col}`), ', ')}
          `;
                    const modifiedRowAlias = sql.identifier(Symbol());
                    const query = queryFromResolveData(modifiedRowAlias, modifiedRowAlias, resolveData, {}, null, resolveContext, resolveInfo.rootValue);
                    let row;
                    try {
                        await pgClient.query('SAVEPOINT graphql_mutation');
                        const rows = await viaTemporaryTable(pgClient, sql.identifier(table.namespace.name, table.name), mutationQuery, modifiedRowAlias, query);
                        row = rows[0];
                        await pgClient.query('RELEASE SAVEPOINT graphql_mutation');
                    }
                    catch (e) {
                        await pgClient.query('ROLLBACK TO SAVEPOINT graphql_mutation');
                        throw e;
                    }
                    if (!row) {
                        throw new Error(`No values were updated in collection '${inflection.pluralize(inflection._singularizedTableName(table))}' because no values you can update were found matching these criteria.`);
                    }
                    return {
                        clientMutationId: input.clientMutationId,
                        data: row
                    };
                }
                newFields = extend(newFields, {
                    [fieldName]: newFieldWithHooks
                }, `Adding mn update mutation for ${describePgEntity(constraint)}`);
            });
        }
        return extend(fields, newFields, `Adding the many 'update' mutation to the root mutation`);
    }
};
exports.default = PostGraphileManyUpdatePlugin;
//# sourceMappingURL=PostGraphileManyUpdatePlugin.js.map