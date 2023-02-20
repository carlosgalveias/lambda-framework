'use strict';
/**
 * Generic get,post,put,delete router
 * This servers most of the db purposes that follows EmberJs conventions, if you wish to make a more custom method
 * create the model file in this folder as '{model}.js' or '{model}-id.js'.
 * then simply import this module and use it as you please as you can override methods
 * or simply do something after the data is collected.
 * ex:
 *
 * var template = require('./generic.js');
 * var customController = require('../controllers/customController.js');
 * var customRoute = {}; // our custom router, not a reference
 * customRoute.get = template.get;
 * customRoute.post = template.post;
 * customRoute.delete = template.delete;
 *
 * // This methods have some extra actions after they are applied
 * customRoute.put = function(req, res) {
 *   let globalRoute = template; // we use our global 'put' method
 *   globalRoute.put(req, function(result) {
 *     if (result.status === 200) {
 *       customController.doSomeThingCustom(result); // when that works regenrate the extension files
 *      }
 *     return res(result); // return our success
 *     });
 *  };
 *  module.exports = customRoute;
 *
 * In this example we overrided the put method where we wanted to do something
 * after the PATCH response.
 */
const utilDatabase = require('../utils/util-database');
const pluralize = require('pluralize');
/**
 * Initialize database connection, if its not initialized already or use the already initialized connection
 * @return {void}
 */
let orm; // Initialize our waterline orm
const initDb = async function() {
  orm = orm || await utilDatabase.initDb();
};

const createData = function(data) {
  return new Promise((resolve, reject) => {
    const model = pluralize(data.type);
    const db = orm.waterline.collections[model]; // get the table
    // console.log('generic->createData->', model, data.attributes);
    db.create(data.attributes)
      .exec((err, res) => {
        if (err) {
          return reject(err);
        }
        return resolve({ id: res.id, type: data.type });
      });
  });
};

/**
 * JSON API has attributes and relationships, however the ORM handles relationships as it would for attributes
 * So we just need to transform:
 * relationships: {
 *   myrelation: {
 *    id: 1, type: relations
 *   }
 * }
 * to
 * {myrelation: 1}
 * However we may need to create it if needed in case we have a embeeded relationship
 * @param  {object} relationships the relationship objects
 * @return {object}               the key value par with relationship ids
 */
const flattenRelationship = async function(relationship) {
  const keys = Object.keys(relationship);
  const obj = {};
  for (const key of keys) {
    const data = relationship[key].data || null;
    if (!data) {
      obj[key] = null;
      continue;
    }
    if (Array.isArray(data)) {
      for (const d of data) {
        d.id = d.id ? d.id : (await createData(d)).id;
      }
      obj[key] = await data.map(d => d.id);
    } else {
      obj[key] = data.id ? data.id : (await createData(data)).id;
    }
  }
  return obj;
};

const flattenRelationships = async function(relationships) {
  const isArray = Array.isArray(relationships);
  if (!relationships) {
    return {};
  }
  if (!isArray) {
    return flattenRelationship(relationships); // just one lets do that
  }
  const returnRelationShips = [];
  for (const relationship of relationships) {
    const r = await flattenRelationship(relationship);
    returnRelationShips.push(r);
  }
  return returnRelationShips;
};

const deepFirstSearch = (obj, convert) => { // faz um dfs pelo objecto e aplica a lambda convert
  try {
    if (convert == null || obj === undefined || obj === null) { // fast escape
      console.log('returning as null or undefined');
      return obj;
    }
    if (obj != null && Array.isArray(obj) && obj.length) { // caso seja arrays
      for (const i in obj) {
        obj[i] = deepFirstSearch(obj[i], convert);
      }
      if (obj.length === 1) {
        obj = obj[0];
      }
    } else if (obj != null && typeof obj === 'object' && !(obj instanceof Date)) { // caso seja um objecto (sem ser date)
      for (const k of Object.keys(obj)) {
        obj[k] = deepFirstSearch(obj[k], convert);
      }
    } else { // caso seja primitiva
      obj = convert(obj);
    }
    return obj;
  } catch (err) {
    console.error(err);
    return obj;
  }
};
const normalizeQuery = (e) => {
  try {
    if (typeof e === 'string' && e !== 'null' && e !== '') {
      e = e.match(/^\d+$/) ? parseInt(e) : e;
    } else if (e !== null && typeof e === 'object' && e.length) {
      e = e.map(i => typeof i === 'string' && i.match(/^\d+$/) ? parseInt(i) : i);
    } else if (e !== null && typeof e === 'string' && e === 'null') {
      e = null;
    }
    return e;
  } catch (err) {
    console.error(err);
    return e;
  }
};

const returnData = async function(result, cb) {
  if (cb) {
    return cb(result);
  }
  return result;
};

const generic = {
  getOrm: async function() {
    await initDb();
    return orm;
  },
  /**
   * Generic get method to read data from db compatible with EmberJS conventions
   * any db query params can be sent as .. well.. query params,
   * including pagination.
   * In this method we auto populate all relationships regarding a specific model.
   * This avoids a EmberJS application to make constantly thousands of requests for every single bit of information.
   * For this to work properly you need to set up your ember models to Serialize/Deserialize properly.
   * We also include 'meta: totalrecords' to help pagination when needed
   *
   * @param  {object} req Request object
   * @param  {object} res Result Object
   */
  get: async function(req, res) {
    try {
      const table = req.params['0'];
      const id = req.params.id ? req.params.id : req.params[1]; // Id if any
      console.log('get->' + table + (id ? '->id:' + id : '') + '->query->' + JSON.stringify(req.query));
      try {
        await initDb();
      } catch (e) {
        console.error('failure to initialize database');
        return returnData({ status: 500, result: { error: e } }, res);
      }
      const start = +new Date();
      // route called corresponds to the table as a convention

      const db = orm.waterline.collections[table]; // get the table
      if (!db) {
        return returnData({ status: 500, result: { error: 'Invalid Table ' + table } }, res);
      }
      const attributes = db.attributes;
      const populations = []; // We need to populate collections or we wont get the data
      const models = []; // this are the model relationships that we need to include in relationships
      const populateFilters = []; // the filtering

      console.log('get->First query pass', 'Elapsed:', +new Date() - start + 'ms');
      // before parsing query itenms, lets make sure all jsons that come in strings are parsed
      for (const key of Object.keys(req.query)) {
        if (typeof req.query[key] !== 'string') {
          continue;
        }
        try {
          const val = JSON.parse(req.query[key]);
          req.query[key] = val;
        } catch (e) {
          // doesn't parse, then leave it as is
        }
      }
      console.log('query before deepFirstSearch', req.query);
      // Iterate trough query using a deepFirstSearch to parse integers and 'nulls'
      req.query = deepFirstSearch(req.query, normalizeQuery);
      // Add our populations
      console.log('query after deepFirstSearch', req.query);
      console.log('get->parsing attributes', 'Elapsed:', +new Date() - start + 'ms');
      Object.keys(attributes)
        .forEach(key => {
          // console.log(key, attributes[key]);
          if (attributes[key].model) {
            models.push(key);
          } else if (attributes[key].collection) {
            // When models are many to many, 'have "via"', they are not columns in our table so we cannot count them
            // we have to use this as a post query filter.
            // This breaks pagination for these cases.
            if (req.query[key] && attributes[key].via) {
              populateFilters.push({ key: key, query: req.query[key] });
              delete req.query[key];
            }
            // adds all relationships to be populated as we need to get their ids
            populations.push(key);
          }
        });
      // Limits, skip and sort are removed from query params
      console.log('get->clean query', 'Elapsed:', +new Date() - start + 'ms');
      const limit = req.query.limit ? req.query.limit : 100;
      const skip = req.query.skip ? req.query.skip : 0;
      const sort = req.query.sort ? req.query.sort : { id: 'ASC' };
      const nestedRelationships = populations;
      delete req.query.limit;
      delete req.query.skip;
      delete req.query.sort;
      delete req.query.populate;
      // If we are specifying a id , we dont care about our filters
      // console.log(id);
      // console.log(typeof id);
      const filter = req.query;
      if (id) {
        if (!filter.id) {
          filter.id = id;
          // eslint-disable-next-line eqeqeq
        } else if (filter.id != id) {
          return returnData({ status: 404, result: { error: 'item not found' } }, res);
        }
        let match = (id + '').match(/^\d+$/);
        if (!match) {
          return returnData({ status: 500, result: { error: 'invalid id' } }, res);
        }
      }
      console.log('get->counting', 'Elapsed:', +new Date() - start + 'ms');
      let count = 0;
      let results = [];
      try {
        count = await db.count().where(filter);
      } catch (e) {
        console.error('error at couting data', e);
        return returnData({ status: 500, result: { error: e } }, res);
      }

      console.log('get->getting results->count(' + count + ')', 'Elapsed:', +new Date() - start + 'ms');
      try {
        console.log('get->fetching db results->', 'Elapsed:', +new Date() - start + 'ms');
        results = !count ? [] : await db.find().populate(nestedRelationships).where(filter).limit(limit).skip(skip).sort(sort);
        console.log('get->done fetching db results->', 'Elapsed:', +new Date() - start + 'ms');
      } catch (e) {
        console.error('error at getting results', e);
        return returnData({ status: 500, result: { error: e } }, res);
      }

      console.log(!!('get->populateFilters->' + results.length), 'Elapsed:', +new Date() - start + 'ms');
      if (populateFilters && results && results.length > 0) {
        let newResults = [];
        populateFilters.forEach(f => {
          const key = f.key;
          const query = typeof f.query === 'object' ? f.query : [f.query];
          results.forEach(r => {
            if (r[key] && r[key].length > 0) {
              let eligable = false;
              for (let i = 0; i < r[key].length; i++) {
                if (query.indexOf(r[key][i].id) >= 0) {
                  eligable = true;
                  break;
                }
              }
              if (eligable) {
                newResults.push(r);
              }
            }
          });
          results = newResults;
          newResults = [];
        });
      }

      if (id && results.length === 0) {
        return returnData({ status: 404, result: { error: 'item not found' } }, res);
      }

      console.log('get->building metadata', 'Elapsed:', +new Date() - start + 'ms');
      const ret = {}; // return object
      ret.meta = {
        query: filter,
        limit: limit,
        skip: skip,
        sort: sort
      };
      ret.meta.totalrecords = count;

      // results is a special object , so we need to map it and get the attributes in json api format
      // this way is more efficient.
      ret.data = results.map(result => {
        const att = {};
        const relationships = {};
        Object.keys(result).forEach(p => {
          if (result[p] && attributes[p] && attributes[p].collection && result[p].length > 0) {
            const relType = pluralize(attributes[p].collection);
            relationships[p] = {
              data: result[p].map(r => {
                return { type: relType, id: r.id };
              })
            };
          } else if (result[p] && attributes[p] && attributes[p].model) {
            const relType = pluralize(attributes[p].model);
            relationships[p] = { data: { type: relType, id: result[p] } };
          } else if (!attributes[p] || (!attributes[p].collection && !attributes[p].model)) {
            att[p] = result[p];
          };
        });
        return { type: table, id: result.id, attributes: att, relationships };
      });
      if (id) {
        ret.data = ret.data[0];
      }
      if (!ret.data) {
        return returnData({ status: 404, result: { error: 'item not found' } }, res);
      }
      console.log('get->returning', 'Elapsed:', +new Date() - start + 'ms');
      return returnData({ status: 200, result: ret }, res);
    } catch (e) {
      console.log('get->flowerror', e);
      return returnData({ status: 500, result: { error: e } }, res);
    }
  },
  /**
   * Generic put method to update data from db
   * @param  {object} req Request object
   * @param  {object} res Result Object
   */
  patch: async function(originalReq, res) {
    try {
      // Since we use req to return the results, to avoid changes by reference we make
      // a copy of the originalReq here.
      let req;
      try {
        req = JSON.parse(JSON.stringify(originalReq));
      } catch (e) {
        req = originalReq;
      }
      // console.log('body', JSON.stringify(req.body, null, 2));
      const table = req.params['0'];
      const id = req.params.id ? req.params.id : req.params[1]; // Id if any
      if (!id) {
        return returnData({ status: 500, result: { error: 'no id specified for patch' } }, res);
      }
      const match = (id + '').match(/^\d+$/);
      if (!match) {
        return returnData({ status: 500, result: { error: 'invalid id' } }, res);
      }
      console.log('patch->' + table + (id ? '->id:' + id : ''));
      try {
        await initDb();
      } catch (e) {
        console.error('failure to initialize database');
        return returnData({ status: 500, result: { error: e } }, res);
      }
      console.log('patch->starting');

      if (!req.body || Object.entries(req.body).length === 0 || !table) {
        return returnData({ status: 500, result: { error: 'Invalid Request' } }, res);
      }

      if ((req.body.data && req.body.data.id && req.body.data.id != id) || (req.body.data && req.body.data.attributes.id && req.body.data.attributes.id != id)) {
        console.error('Attempting to patch data from different id than provided in query');
        console.error('query', req.query);
        console.error('body', JSON.stringify(req.body, null, 2));
        return returnData({ status: 500, result: { error: 'Invalid Request' } }, res);
      }

      const db = orm.waterline.collections[table];
      const objectattr = req.body.data.attributes;

      if (objectattr.password === null) {
        delete objectattr.password;
      }
      const relationships = req.body.data.relationships;
      if (relationships) {
        const relationshipstoadd = await flattenRelationships(relationships);
        const relKeys = Object.keys(relationshipstoadd);
        if (relKeys.includes('project') && !relationshipstoadd.project) {
          console.log('PATCH WITH NO PROJECT', originalReq);
          delete relationshipstoadd.project;
        }
        if (relKeys.includes('company') && !relationshipstoadd.company) {
          console.log('PATCH WITH NO COMPANY', originalReq);
          delete relationshipstoadd.company;
        }
        Object.assign(objectattr, relationshipstoadd);
      }
      objectattr.id = id; // in case our attributes dont' have the id set
      try {
        //console.log('generic->patch->updating', table, id, objectattr);
        await db.update(id, objectattr);
      } catch (e) {
        console.error('patch->update->error', e);
        return returnData({ status: 500, result: { error: e } }, res);
      }
      return returnData({ status: 200, result: { data: { id: id, attributes: req.body.data.attributes, relationships: relationships, type: table } } }, res);
    } catch (e) {
      console.log('post->flowerror', e);
      return returnData({ status: 500, result: { error: e } }, res);
    }
  },
  /**
   * Generic post method to create data on db
   * When a post includes relationships, it should automatically detect/create the relationships
   * the flow is:
   * it accepts single object or array of objects
   *
   * @param  {object} req Request object
   * @param  {object} res Result Object
   */
  post: async function(originalReq, res) {
    try {
      // Since we use req to return the results, to avoid changes by reference we make
      // a copy of the originalReq here.
      const start = +new Date();
      console.log('generic->post->start');
      let req;
      try {
        req = JSON.parse(JSON.stringify(originalReq));
      } catch (e) {
        req = originalReq;
      }
      console.log('generic->post->clone request timing', 'Elapsed:', +new Date() - start + 'ms');
      const table = req.params['0'];
      console.log('generic->post->table' + table);
      try {
        await initDb();
        console.log('generic->post->init database timing', 'Elapsed:', +new Date() - start + 'ms');
      } catch (e) {
        console.error('failure to initialize database');
        console.error(e);
        return returnData({ status: 500, result: { error: e } }, res);
      }

      if (!req.body || Object.entries(req.body).length === 0 || !table) {
        return returnData({ status: 500, result: { error: 'Invalid Request' } }, res);
      }
      const db = orm.waterline.collections[table]; // get the table
      let objectattr = null;
      let relationships = null;
      let isPostArray = false;
      console.log('generic->post->flattening relationships', 'Elapsed:', +new Date() - start + 'ms');
      if (Array.isArray(req.body.data)) {
        const hasIds = req.body.data.filter(d => d.id || d.attributes.id);
        if (hasIds && hasIds.length) {
          console.error('attempt to force ids inside post');
          return returnData({ status: 500, result: { error: 'Invalid Request' } }, res);
        }
        isPostArray = true;
        objectattr = req.body.data.map(d => d.attributes);
        relationships = req.body.data.map(d => d.relationships || {});
        if (relationships) {
          const relationshipstoadd = await flattenRelationships(relationships);
          for (let i = 0; i < objectattr.length; i++) {
            Object.assign(objectattr[i], relationshipstoadd[i]);
          }
        }
      } else {
        if (req.body.data.id || req.body.data.attributes.id) {
          console.error('attempt to force ids inside post');
          return returnData({ status: 500, result: { error: 'Invalid Request' } }, res);
        }
        objectattr = req.body.data.attributes;
        relationships = req.body.data.relationships;
        if (relationships) {
          const relationshipstoadd = await flattenRelationships(relationships);
          Object.assign(objectattr, relationshipstoadd);
        }
      }
      let results;
      try {
        console.log('generic->post->creating data on db', 'Elapsed:', +new Date() - start + 'ms');
        // console.log('generic->post->create', table, objectattr);
        results = await db.create(objectattr);
        console.log('generic->post->done creating data on db', 'Elapsed:', +new Date() - start + 'ms');
        if (isPostArray) {
          for (let d = 0; d < req.body.data.length; d++) {
            req.body.data[d].id = results[d].id;
          }
        } else {
          req.body.data.id = results.id;
        }
      } catch (e) {
        console.error('post->create->error', e);
        return returnData({ status: 500, result: { error: e } }, res);
      }
      console.log('generic->post->returning data', 'Elapsed:', +new Date() - start + 'ms');
      return returnData({ status: 200, result: { data: req.body.data } }, res);
    } catch (e) {
      console.log('post->flowerror', e);
      return returnData({ status: 500, result: { error: e } }, res);
    }
  },
  /**
   * Generic delete method to delete item(s) from db
   * @param  {object} req Request object
   * @param  {object} res Result Object
   */
  delete: async function(req, res) {
    try {
      const table = req.params['0'];
      console.log({ table });
      if (!table || table === '') {
        return returnData({ status: 500, result: { error: 'invalid table' } }, res);
      }
      try {
        await initDb();
      } catch (e) {
        console.error('failure to initialize database');
        return returnData({ status: 500, result: { error: e } }, res);
      }
      if (!orm.waterline.collections[table]) {
        return returnData({ status: 500, result: { error: 'invalid table' } }, res);
      }
      const id = req.params.id ? req.params.id : req.params[1]; // Id if any

      if (!id) {
        return returnData({ status: 500, result: { error: 'no id specified for deletion' } }, res);
      }
      const match = (id + '').match(/^\d+$/);
      if (!match) {
        return returnData({ status: 500, result: { error: 'invalid id' } }, res);
      }

      try {
        const db = orm.waterline.collections[table]; // get the table
        console.log('generic->post->delete->' + table + (id ? '->id:' + id : '') + '->query->' + JSON.stringify(req.query));
        await db.destroy(id);
      } catch (e) {
        console.error('delete->catch', e);
        return returnData({ status: 500, result: { error: e } }, res);
      }
      return returnData({ status: 200, result: { meta: { success: true } } }, res);
    } catch (e) {
      console.log('post->flowerror', e);
      return returnData({ status: 500, result: { error: e } }, res);
    }
  }
};
module.exports = generic;