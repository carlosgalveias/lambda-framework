'use strict';
/**
 * ORM utilitiees to manipulate objects
 */
const pluralize = require('pluralize');
const orm = require('../models');

const dbutils = {
  initDb: function() {
    return new Promise((resolve, reject) => {
      console.log('initializing database connection');
      if (!orm.waterline.connections) {
        console.log('i dont have a connection yet');
        try {
          orm.waterline.initialize(orm.config, function(err, models) {
            if (err) {
              console.error(err);
              reject(err);
            }
            console.log('database initialized');
            return resolve(orm);
          });
        } catch (e) {
          console.error(e);
          reject(e);
        }
      } else {
        console.log('i have a connection already');
        return resolve(orm);
      }
    });
  },
  /**
   * jsonapi.org sends a payload in a format with meta, data where objects properties are inside data.attributes
   * If there is more than one object, then data is a array.
   * Some attributes will contain a relationships object that contains 'joins' and those are parsed too as internals
   * of the object.
   * This converts into a simple JSON object
   * @param  {[type]} data [description]
   * @return {[type]}      [description]
   */
  jsonApiToObj: function(data) {
    if (data.attributes) {
      const obj = {};
      Object.assign(obj, data.attributes);
      if (data.relationships) {
        Object.assign(obj, dbutils.relationShipsToObj(data.relationships));
        return obj;
      }
    } else {
      const obj = [];
      data.forEach(d => {
        const o = {};
        Object.assign(o, d.attributes);
        if (d.relationships) {
          Object.assign(o, dbutils.relationShipsToObj(d.relationships));
        }
        obj.push(o);
        return obj;
      });
    }
  },
  relationShipsToObj: function(rel) {
    const obj = {};
    console.log({ rel });
    Object.keys(rel)
      .forEach(r => {
        if (rel[r].data && rel[r].data.length > 0) {
          console.log(rel[r].data.length);
          console.log(rel[r].data);
          obj[r] = [];
          rel[r].data.forEach(dr => {
            console.log({ dr });
            if (dr.attributes) {
              obj[r].push(dr.attributes);
            } else if (dr.id) {
              obj[r].push(dr.id);
            } else {
              obj[r].push(dr);
            }
          });
        } else {
          console.log({ r }, rel[r]);
          obj[r] = rel[r].data.attributes ? rel[r].data.attributes : rel[r].data.id;
        }
      });
    return obj;
  },
  attributesToJSONApi: async function(table, attributes) {
    await dbutils.initDb();
    const db = orm.waterline.collections[table]; // get the table
    const dbattributes = db.attributes;
    const relationships = {};
    for (const p of Object.keys(attributes)) {
      console.log(p, attributes[p]);
      if (dbattributes[p].collection && attributes[p] && attributes[p].length > 0) {
        // console.log('res', JSON.stringify(result[p]));
        const relType = pluralize(dbattributes[p].collection);
        relationships[p] = {
          data: attributes[p].map(r => {
            return { type: relType, r };
          })
        };
        delete attributes[p];
        // console.log('rel', p, JSON.stringify(relationships[p]));
      } else if (attributes[p] && dbattributes[p].model) {
        const relType = pluralize(dbattributes[p].model);
        relationships[p] = { data: { type: relType, id: attributes[p] } };
        delete attributes[p];
      }
    }
    return { attributes, relationships };
  }

};
module.exports = dbutils;