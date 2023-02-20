'use strict';
const utilDatabase = require('../utils/util-database');
let orm; // Initialize our waterline orm
const initDb = async function() {
  orm = orm || await utilDatabase.initDb();
};

const DBActions = {
  read: async function(args) {
    let res = [];
    await initDb();
    const table = args.table;
    const db = orm.waterline.collections[table];
    if (!db) {
      throw ('error accessing table', table);
    }
    console.log('storage-db->read', table);
    if (args.limit) {
      if (args.attributes) {
        res = await db.find({
          where: args.query,
          select: args.select ? args.select : '*'
        }).limit(args.limit).populate(args.attributes);
      } else {
        res = await db.find({
          where: args.query,
          select: args.select ? args.select : '*'
        }).limit(args.limit);
      }
    } else {
      if (args.attributes) {
        res = await db.find({
          where: args.query,
          select: args.select ? args.select : '*'
        }).populate(args.attributes);
      } else {
        res = await db.find({
          where: args.query,
          select: args.select ? args.select : '*'
        });
      }
    }
    if (res[0]) {
      return res;
    } else {
      // console.error('Could not find any data with that ID', JSON.stringify(args, null, 2))
      return null;
    }
  },

  query: async function(args) {
    let res = [];
    await initDb();
    const table = args.table;
    //console.log('DB->Query', table);
    const db = orm.waterline.collections[table];
    if (!db) {
      throw ('error accessing table', table);
    }
    console.log('storage-db->query', table);
    return new Promise((resolve, reject) => {
      db.query(args.query, args.params || [], function(err, rawResult) {
        if (err) { return reject(err); }

        res = rawResult.rows;
        if (res && res[0]) {
          return resolve(res);
        } else {
          // console.error('Could not find any data with that ID', JSON.stringify(args, null, 2))
          return resolve(null);
        }
      });
    });
  },

  readSort: async function(args) {
    let res = [];
    await initDb();
    const table = args.table;
    const skip = args.skip ? args.skip : 0;
    console.log('storage-db->ReadSort', table);
    const db = orm.waterline.collections[table];
    if (!db) {
      throw ('error accessing table');
    }
    // console.log('storage-db->', table, 'readSort', args.query, args.data, args.sort, args.limit, args.attributes);
    if (args.limit) {
      if (args.attributes) {
        res = await db.find({
          where: args.query
        }).sort(args.sort).skip(skip).limit(args.limit).populate(args.attributes);
      } else {
        res = await db.find({
          where: args.query
        }).sort(args.sort).skip(skip).limit(args.limit);
      }
    } else {
      if (args.attributes) {
        res = await db.find({
          where: args.query
        }).sort(args.sort).populate(args.attributes);
      } else {
        res = await db.find({
          where: args.query
        }).sort(args.sort);
      }
    }
    if (res[0]) {
      return res;
    } else {
      // console.error('Could not find any data with that ID', JSON.stringify(args, null, 2))
      return null;
    }
  },

  count: async function(args) {
    //console.log('DB->Count');
    let res = [];
    await initDb();
    const table = args.table;
    //console.log('DB->Count->Getting collections');
    const db = orm.waterline.collections[table];
    if (!db) {
      throw ('error accessing table');
    }
    if (args.count) {
      //console.log('DB->Count>Getting With Count');
      res = await db.count(args.count);
    } else {
      //console.log('DB->Count->Getting Without Count');
      res = await db.count();
    }
    //console.log('DB->Count->Returning');
    if (res) {
      return res;
    } else {
      // console.error('Could not find any data with that ID', JSON.stringify(args, null, 2))
      return null;
    }
  },

  write: async function(args) {
    await initDb();
    const table = args.table;
    console.log('storage-db->write', table);
    const db = orm.waterline.collections[table];
    const res = await db.create(args.data);
    if (res) {
      return res;
    } else {
      console.error('Could not POST');
      return null;
    }
  },

  destroy: async function(args) {
    await initDb();
    const table = args.table;
    const db = orm.waterline.collections[table];
    // console.log('storage-db->', table, 'destroy', args.query);
    const res = await db.destroy(args.query);
    if (res) {
      return res;
    } else {
      console.error('Record not found');
      return null;
    }
  },

  update: async function(args) {
    await initDb();
    const table = args.table;
    const db = orm.waterline.collections[table];
    if (!db) {
      throw ('error accessing table');
    }
    // console.log('storage-db->', table, 'update', args.query, args.data);
    // dont allow to update project with undefined or null values
    const keys = Object.keys(args.data);
    if (keys.includes('project') && !args.data.project) {
      // project exists in keys but its undefined or null
      delete args.data.project;
      console.error('NO PROJECT?!?');
      console.error(JSON.stringify(args, null, 2));
    }
    if (keys.includes('company') && !args.data.company) {
      // project exists in keys but its undefined or null
      delete args.data.company;
      console.error('NO COMPANY?!?');
      console.error(JSON.stringify(args, null, 2));
    }
    // optimização: evita um round trip à bd quando tem id
    let id = args.query.id;
    if (id != null) {
      if (Array.isArray(id) && id.length === 1) { // se o id é um array, só deverá atualizar o primeiro id e por isso o id é o indice 0
        id = id[0];
      }
      const result = await db.update({ ...args.query, id }, args.data); // usa o query original + o id
      if (result.length === 0) { // escrever console log (acho desnecessário)
        console.error('Could not find any data with that ID', JSON.stringify(args, null, 2));
      }
      return result.length === 0 ? null : result; // devolve o resultado ou null se zero updates
    }

    // codigo antigo, funcionalidade antiga
    const res = await db.find({ where: args.query });
    if (res[0]) {
      const result = await db.update(res[0].id, args.data);
      return result;
    } else {
      console.error('Could not find any data with that ID', JSON.stringify(args, null, 2));
      return null;
    }
  }
};

// function
const storageDB = async function(args) {
  if (!args || !args.type) {
    throw ('invalid request');
  }
  console.log('Activation Calling StorageDB', args.requestActivation);
  try {
    const res = await DBActions[args.type](args);
    if (global.gc) {
      global.gc(); // cleanup
    }
    return { result: res };
  } catch (e) {
    console.error('#### ERROR AT STORAGE-DB ####');
    console.error('args', JSON.stringify(args, null, 2));
    console.error(e);
    if (global.gc) {
      global.gc(); // cleanup
    }
    throw (e);
  }
};
module.exports = storageDB;
module.exports.config = {
  memory: 1024,
  timeout: 60000,
  logsize: 10
};