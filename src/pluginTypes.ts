import gql, {
  GraphQLSchema,
  GraphQLObjectTypeConfig,
  GraphQLType,
  GraphQLInputObjectType
} from 'graphql';
import sql, { SQL } from 'pg-sql2';
import { PgClass, PgAttribute, omit } from 'graphile-build-pg';
import pgField from 'graphile-build-pg/node8plus/plugins/pgField';
import { Plugin, SchemaBuilder } from 'graphile-build';
import { parseResolveInfo } from 'graphql-parse-resolve-info';

/**
 * Whereas the Build object is the same for all hooks (except the build hook
 * which constructs it) within an individual build, the Context object changes for each hook.
 * The main ones are scope, Self, & fieldWithHooks(fieldName, spec, scope = {})
 * https://www.graphile.org/graphile-build/context-object/
 */
export interface Context {
  scope: {
    isRootMutation: boolean;
    [str: string]: any;
  };
  fieldWithHooks: FieldWithHooksFunction;
}
export interface FieldWithHooksFunction {
  (fieldName: string, spec: any, fieldScope?: any): any;
}

/**
 * The build object represents the current schema build and is passed to
 * all hooks, hook the 'build' event to extend this object.
 * https://www.graphile.org/graphile-build/build-object/
 * */
export interface Build {
  /**
   * https://graphql.org/graphql-js/type/
   */
  graphql: typeof gql;
  /**
   * https://github.com/graphile/graphile-engine/tree/master/packages/pg-sql2
   */
  pgSql: typeof sql;
  /**
   * https://github.com/graphile/graphile-engine/blob/953675007d745be51a1c29d3e533636233d8aa0f/packages/graphile-build-pg/src/plugins/PgTypesPlugin.js#L117
   */
  gql2pg: (
    val: any | null,
    type: {
      id: string | number;
      domainBaseType: any;
      domainTypeModifier: any;
      isPgArray: any;
      namespaceName: any;
      name: any;
      arrayItemType: any;
    } | null,
    modifier: any
  ) => any;
  /**
   * https://github.com/graphile/graphile-engine/blob/9dca5c8631e6c336b59c499d901c774d41825c60/packages/graphile-build-pg/src/plugins/PgBasicsPlugin.js#L327
   */
  pgOmit: typeof omit;
  extend: (base: Object, extra: Object, hint?: string) => any;
  newWithHooks: (
    Class: any,
    spec: any,
    scope: any,
    performNonEmptyFieldsCheck?: boolean
  ) => any;
  parseResolveInfo: typeof parseResolveInfo;
  /**
   * https://github.com/graphile/graphile-engine/blob/bfe24276c9ff5eb7d3e9e7aff56a4d2ea61f30c6/packages/graphile-build-pg/src/plugins/PgIntrospectionPlugin.js#L1065
   * https://github.com/graphile/graphile-engine/blob/bfe24276c9ff5eb7d3e9e7aff56a4d2ea61f30c6/packages/graphile-build-pg/src/queryFromResolveDataFactory.js
   */
  pgQueryFromResolveData: any;
  /**
   * Inflection is used for naming resulting types/fields/args/etc - it's
   * hookable so that other plugins may extend it or override it
   * https://www.graphile.org/postgraphile/inflection/#gatsby-focus-wrapper
   */
  inflection: any;
  pgField: typeof pgField;
  [str: string]: any;
}

export {
  PgClass,
  PgAttribute,
  omit,
  SQL,
  Plugin,
  SchemaBuilder,
  GraphQLType,
  GraphQLInputObjectType
};
