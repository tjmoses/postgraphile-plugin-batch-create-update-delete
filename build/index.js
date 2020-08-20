"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const graphile_utils_1 = require("graphile-utils");
const PostGraphileManyCreatePlugin_1 = __importDefault(require("./PostGraphileManyCreatePlugin"));
const PostGraphileManyUpdatePlugin_1 = __importDefault(require("./PostGraphileManyUpdatePlugin"));
const PostGraphileManyDeletePlugin_1 = __importDefault(require("./PostGraphileManyDeletePlugin"));
const PostGraphileManyCUDPlugin = graphile_utils_1.makePluginByCombiningPlugins(PostGraphileManyCreatePlugin_1.default, PostGraphileManyUpdatePlugin_1.default, PostGraphileManyDeletePlugin_1.default);
exports.default = PostGraphileManyCUDPlugin;
//# sourceMappingURL=index.js.map