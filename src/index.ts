import { makePluginByCombiningPlugins } from 'graphile-utils';
import PostGraphileManyCreatePlugin from './PostGraphileManyCreatePlugin';
import PostGraphileManyUpdatePlugin from './PostGraphileManyUpdatePlugin';
import PostGraphileManyDeletePlugin from './PostGraphileManyDeletePlugin';

const PostGraphileManyCUDPlugin = makePluginByCombiningPlugins(
  PostGraphileManyCreatePlugin,
  PostGraphileManyUpdatePlugin,
  PostGraphileManyDeletePlugin
);
export default PostGraphileManyCUDPlugin;
