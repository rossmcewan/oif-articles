const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const middy = require("middy");
const {
  cors,
  httpEventNormalizer,
  httpHeaderNormalizer,
  jsonBodyParser,
} = require("middy/middlewares");
const slug = require("slug");
const uuid = require("uuid");

const TableName = `Articles-${process.env.STAGE}`;

const isFavorited = async (username, articleId) => {
  const result = await docClient
    .get({
      TableName,
      Key: {
        id: articleId,
        entryType: `FAVORITE:${username}`,
      },
    })
    .promise();
  if (result.Item) return true;
  return false;
};

//auth.optional
const _getArticles = async (event) => {
  const {
    requestContext: {
      authorizer: { jwt: { claims: { username } = {} } = {} } = {},
    } = {},
  } = event;
  const articles = await docClient
    .query({
      TableName,
      IndexName: "idx_entry_types",
      ScanIndexForward: false,
      KeyConditionExpression: "#entryType = :article",
      ExpressionAttributeNames: {
        "#entryType": "entryType",
      },
      ExpressionAttributeValues: {
        ":article": "ARTICLE",
      },
    })
    .promise();
  return {
    articles: await Promise.all(
      articles.Items.map(async (article) => {
        return {
          slug: article.slug,
          title: article.title,
          description: article.description,
          body: article.body,
          createdAt: article.createdAt,
          updatedAt: article.updatedAt,
          tagList: article.tagList,
          favorited: username ? await isFavorited(username, article.id) : false,
          favoritesCount: article.favoritesCount,
          author: article.author, //need to get author
        };
      })
    ),
    artciclesCount: articles.Count,
  };
};

const _getArticleFeed = async (event) => {
  const {
    requestContext: {
      authorizer: { jwt: { claims: { username } = {} } = {} } = {},
    } = {},
  } = event;
  const followingResult = await docClient
    .query({
      TableName,
      KeyConditionExpression:
        "#id = :username AND begins_with(#entryType, :following)",
      ExpressionAttributeNames: {
        "#id": "id",
        "#entryType": "entryType",
      },
      ExpressionAttributeValues: {
        ":username": username,
        ":following": "FOLLOWING",
      },
    })
    .promise();
  if (followingResult.Count) {
    const followingUsers = followingResult.Items.map(
      (f) => f.entryType.split(":")[1]
    );
    const params = {
      TableName,
      IndexName: "idx_entry_types",
      KeyConditionExpression: "#entryType = :article",
      FilterExpression: `#author IN (${followingUsers
        .map((x) => `:${x}`)
        .join(",")})`,
      ExpressionAttributeNames: {
        "#author": "author",
        "#entryType": "entryType",
      },
      ExpressionAttributeValues: {},
    };
    followingUsers.forEach((fu) => {
      params.ExpressionAttributeValues[`:${fu}`] = fu;
    });
    console.log("params", params);
    const followeArticles = await docClient.query(params).promise();
    return {
      articles: await Promise.all(
        followeArticles.Items.map(async (article) => {
          return {
            slug: article.slug,
            title: article.title,
            description: article.description,
            body: article.body,
            createdAt: article.createdAt,
            updatedAt: article.updatedAt,
            tagList: article.tagList,
            favorited: username
              ? await isFavorited(username, article.id)
              : false,
            favoritesCount: article.favoritesCount,
            author: article.author, //need to get author
          };
        })
      ),
      artciclesCount: followeArticles.Count,
    };
  }
  return [];
};

const _createArticle = async (event) => {
  const {
    requestContext: {
      authorizer: { jwt: { claims: { username } = {} } = {} } = {},
    } = {},
  } = event;
  const article = {
    ...event.body.article,
    id: uuid.v4(),
    entryType: "ARTICLE",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slug:
      slug(this.title) +
      "-" +
      ((Math.random() * Math.pow(36, 6)) | 0).toString(36),
    author: username,
  };
  await docClient
    .put({
      TableName,
      Item: article,
    })
    .promise();
  return { article };
};

//auth.optional
const _getArticle = async (event) => {
  const id = event.pathParameters.article;
  const articleResult = await docClient
    .get({
      TableName,
      Key: {
        id,
        entryType: "ARTICLE",
      },
    })
    .promise();
  return {
    article: articleResult.Item,
  };
};

const _updateArticle = async (event) => {
  const {
    requestContext: {
      authorizer: { jwt: { claims: { username } = {} } = {} } = {},
    } = {},
  } = event;
  const { article } = event.body;
  const slug = event.pathParameters.article;
  const articleItem = await getArticleBySlug(slug);
  if (articleItem) {
    await docClient
      .update({
        TableName,
        Key: {
          id: articleItem.Items[0].id,
          entryType: articleItem.Items[0].entryType,
        },
        ConditionExpression: "#author = :author",
        UpdateExpression:
          "SET #title = :title, #description = :description, #body = :body, #tagList = :tagList",
        ExpressionAttributeNames: {
          "#author": "author",
          "#title": "title",
          "#body": "body",
          "#description": "description",
          "#tagList": "tagList",
        },
        ExpressionAttributeValues: {
          ":author": username,
          ":title": article.title,
          ":description": article.description,
          ":body": article.body,
          ":tagList": article.tagList,
        },
      })
      .promise();
    return {
      article: {
        ...articleItem.Items[0],
        ...article,
      },
    };
  }
  return {
    statusCode: 404,
  };
};

const getArticleBySlug = async (slug) => {
  const result = await docClient
    .query({
      TableName,
      IndexName: "idx_slug",
      KeyConditionExpression: "#slug = :slug",
      ExpressionAttributeNames: {
        "#slug": "slug",
      },
      ExpressionAttributeValues: {
        ":slug": slug,
      },
      Limit: 1,
    })
    .promise();
  if (result.Count) return result.Items[0];
  return null;
};

const _deleteArticle = async (event) => {
  const {
    requestContext: {
      authorizer: { jwt: { claims: { username } = {} } = {} } = {},
    } = {},
  } = event;
  const slug = event.pathParameters.article;
  const articleItem = await getArticleBySlug(slug);
  if (articleItem) {
    await docClient.batchWrite({
      RequestItems: {
        [TableName]: [
          {
            DeleteRequest: {
              Key: { id: articleItem.Items[0].id },
            },
          },
        ],
      },
    });
    return {
      statusCode: 204,
    };
  }
  return {
    statusCode: 404,
  };
};

const _favoriteArticle = async (event) => {
  const {
    requestContext: {
      authorizer: { jwt: { claims: { username } = {} } = {} } = {},
    } = {},
  } = event;
  const slug = event.pathParameters.article;
  const articleItem = await getArticleBySlug(slug);
  if (articleItem) {
    await docClient.put({
      TableName,
      Item: {
        id: articleItem.id,
        entryType: `FAVORITE:${username}`,
      },
    });
    await docClient
      .update({
        TableName,
        Key: {
          id: articleItem.id,
          entryType: "ARTICLE",
        },
        UpdateExpression: "SET #favoritesCount = #favoritesCount + :increment",
        ExpressionAttributeNames: {
          "#favoritesCount": "favoritesCount",
        },
        ExpressionAttributeValues: {
          ":increment": 1,
        },
      })
      .promise();
    return {
      article: {
        ...articleItem,
        favoritesCount: articleItem.favoritesCount + 1,
      },
    };
  }
  return {
    statusCode: 404,
  };
};

const _unfavoriteArticle = async (event) => {
  const {
    requestContext: {
      authorizer: { jwt: { claims: { username } = {} } = {} } = {},
    } = {},
  } = event;
  const slug = event.pathParameters.article;
  const articleItem = await getArticleBySlug(slug);
  if (articleItem) {
    await docClient.put({
      TableName,
      Item: {
        id: articleItem.id,
        entryType: `FAVORITE:${username}`,
      },
    });
    await docClient
      .update({
        TableName,
        Key: {
          id: articleItem.id,
          entryType: "ARTICLE",
        },
        UpdateExpression: "SET #favoritesCount = #favoritesCount - :increment",
        ExpressionAttributeNames: {
          "#favoritesCount": "favoritesCount",
        },
        ExpressionAttributeValues: {
          ":increment": 1,
        },
      })
      .promise();
    return {
      article: {
        ...articleItem,
        favoritesCount: articleItem.favoritesCount - 1,
      },
    };
  }
  return {
    statusCode: 404,
  };
};

//auth.optional
const _getComments = async (event) => {};

const _createComment = async (event) => {};

const _deleteComment = async (event) => {};

const _follow = async (event) => {};

const _unfollow = async (event) => {};

const _getTags = async (event)=>{
  const tags = await docClient.scan({
    TableName,
    IndexName: 'idx_tag'
  }).promise();
  return {
    tags: tags.Items.map(x=>x.tag)
  }
}

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
  follow: wrap(_follow),
  unfollow: wrap(_unfollow),
  getTags: wrap(_getTags)
};
