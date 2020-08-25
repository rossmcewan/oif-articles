const AWS = require("aws-sdk");
const stepFunctions = new AWS.StepFunctions();
const docClient = new AWS.DynamoDB.DocumentClient();

const mongoose = require("mongoose");
const UserSchema = require("./models/User");
const ArticleSchema = require("./models/Article");
const CommentSchema = require("./models/Comment");

let conn;

const connect = async () => {
  if (!conn) {
    conn = mongoose.createConnection(process.env.MONGODB_URI, {
      bufferCommands: false,
      bufferMaxEntries: 0,
    });
  }
  await conn;
  conn.model("User", UserSchema);
  conn.model("Article", ArticleSchema);
  conn.model("Comment", CommentSchema);
};

module.exports.start = async (event) => {
  return stepFunctions
    .startExecution({
      stateMachineArn: process.env.MIGRATE_STATE_MACHINE,
      input: JSON.stringify({
        pageSize: process.env.MIGRATE_PAGE_SIZE,
      }),
    })
    .promise();
};

module.exports.getLastImport = async (event) => {
  const lastImport = await docClient
    .query({
      TableName: `Articles-${process.env.STAGE}`,
      IndexName: "idx_tasks",
      ScanIndexForward: false,
      KeyConditionExpression: "#task = :task",
      ExpressionAttributeNames: {
        "#task": "task",
      },
      ExpressionAttributeValues: {
        ":task": "MIGRATION",
      },
      Limit: 1,
    })
    .promise();
  if (lastImport.Items.length) return lastImport.Items[0].id;
  return null;
};

class NoMoreArticles extends Error {
  constructor() {
    super();
    this.name = "NoMoreArticles";
  }
}

module.exports.getNextPageSinceLastImport = async (event) => {
  await connect();
  const { pageSize, lastImport } = event;
  const Article = conn.model("Article");
  const query = {};
  if (lastImport) {
    query._id = { $gt: lastImport };
  }
  const articles = await Article.find(query)
    .limit(Number(pageSize))
    .sort({ _id: "asc" })
    .populate("author")
    .populate({
      path: "comments",
      populate: {
        path: "author",
      },
    })
    .exec();
  if (!articles.length) throw new NoMoreArticles();
  return articles;
};

module.exports.articleMigrated = async (article) => {
  return docClient.put({
    TableName: `Articles-${process.env.STAGE}`,
    Item: {
      id: article._id,
      entryType: "MIGRATED",
      task: "MIGRATION",
      task_timestamp: new Date().toISOString(),
    },
  }).promise();
};

module.exports.migrateArticle = async (article) => {
  const Item = {
    id: article._id,
    entryType: "ARTICLE",
    title: article.title,
    decription: article.description,
    body: article.body,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    favoritesCount: article.favoritesCount,
    author: article.author.email,
    slug: article.slug
  };
  return docClient
    .put({
      TableName: `Articles-${process.env.STAGE}`,
      Item,
    })
    .promise();
};

module.exports.migrateTags = async (article) => {
  const putItems = article.tagList.map((tag) => {
    return {
      PutRequest: {
        Item: {
          id: article._id,
          entryType: `TAG:${tag}`,
          tag,
        },
      },
    };
  });
  if (!putItems.length) return;
  const params = {
    RequestItems: {
      [`Articles-${process.env.STAGE}`]: putItems,
    },
  };
  console.log("params", JSON.stringify(params));
  return docClient.batchWrite(params).promise();
};

module.exports.migrateComments = async (article) => {
  const putItems = article.comments.map((comment) => {
    return {
      PutRequest: {
        Item: {
          id: article._id,
          entryType: `COMMENT:${comment._id}`,
          body: comment.body,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          author: comment.author.email,
        },
      },
    };
  });
  if (!putItems.length) return;
  const params = {
    RequestItems: {
      [`Articles-${process.env.STAGE}`]: putItems,
    },
  };
  console.log("params", JSON.stringify(params));
  return docClient.batchWrite(params).promise();
};

const onlyUnique = (value, index, self) => {
  return self.findIndex(x=>x.id === value.id) === index;
};

module.exports.migrateAuthors = async (article) => {
  const authors = [article.author]
    .concat(article.comments.map((comment) => comment.author))
    .filter(onlyUnique);
  const putItems = authors.map((author) => {
    return {
      PutRequest: {
        Item: {
          id: author.email,
          entryType: "AUTHOR",
          username: author.username,
          email: author.email,
          image: author.image,
        },
      },
    };
  });
  if (!putItems.length) return;
  const params = {
    RequestItems: {
      [`Articles-${process.env.STAGE}`]: putItems,
    },
  };
  console.log("params", JSON.stringify(params));
  return docClient.batchWrite(params).promise();
};
