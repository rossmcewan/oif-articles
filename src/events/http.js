const middy = require("middy");
const {
  cors,
  httpEventNormalizer,
  httpHeaderNormalizer,
  jsonBodyParser,
} = require("middy/middlewares");

//auth.optional
const _getArticles = async (event) => {};

const _getArticleFeed = async (event) => {};

const _createArticle = async (event) => {};

//auth.optional
const _getArticle = async (event) => {};

const _updateArticle = async (event) => {};

const _deleteArticle = async (event) => {};

const _favoriteArticle = async (event) => {};

const _unfavoriteArticle = async (event) => {};

//auth.optional
const _getComments = async (event) => {};

const _createComment = async (event) => {};

const _deleteComment = async (event) => {};

const wrap = (func) => {
  return middy(func)
    .use(cors())
    .use(httpEventNormalizer())
    .use(httpHeaderNormalizer())
    .use(jsonBodyParser());
};

module.exports = {
  getArticles: wrap(_getArticles),
  getArticleFeed: wrap(_getArticleFeed),
  createArticle: wrap(_createArticle),
  getArticle: wrap(_getArticle),
  updateArticle: wrap(_updateArticle),
  deleteArticle: wrap(_deleteArticle),
  favoriteArticle: wrap(_favoriteArticle),
  unfavoriteArticle: wrap(_unfavoriteArticle),
  getComments: wrap(_getComments),
  createComment: wrap(_createComment),
  deleteComment: wrap(_deleteComment),
};
