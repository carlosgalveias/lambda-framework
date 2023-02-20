'use strict';
/**
Database Configuration file
*/

const db = {
  adapter: process.env.RUNNING_TESTS ? 'sails-memory' : 'sails-postgresql',
  host: process.env.RUNNING_LOCALLY ? process.env.DB_ADDRESS : process.env.DB_ADDRESS_PRIVATE || process.env.DB_ADDRESS,
  url: 'postgres://' + process.env.DB_USER + ':' + process.env.DB_PASSWORD + '@' + (process.env.DB_ADDRESS) + ':' + (process.env.DB_PORT) + '/' + process.env.DB_DBNAME,
  port: process.env.DB_PORT,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DBNAME,
  migrate: 'safe',
  poolSize: 1,
  ssl: {
    sslmode: 'require',
    rejectUnauthorized: false
  }
};

module.exports = db;