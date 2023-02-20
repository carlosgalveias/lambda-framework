'use strict';
const s3 = require('s3');
const AWS = require('aws-sdk');
const mime = require('mime-types');
const fs = require('fs');
const stream = require('stream');
const keys = require('../utils/util-keys');


const bucketInstances = {};
const awsInstance = {};

function parseUrl(fullUrl) {
  if (!fullUrl || typeof fullUrl !== 'string') {
    return fullUrl;
  }
  try {
    return fullUrl.replace(/https:\/\/.*[.net,.cloud]\//, '').replace(/\?AWSAccessKeyId=.*$/, '');
  } catch (e) {
    console.error('error trying to replace stuff in fullUrl !??!?!?')
    console.error({ fullUrl, type: typeof fullUrl })
    throw (e);
  }
}

// Iniitiating s3 instance using AWS sdk
const initiateAWSS3 = function(args) {
  const payload = {
    accessKeyId: process.env.STORAGE_S3_ACCESSKEY,
    secretAccessKey: process.env.STORAGE_S3_SECRETACCESSKEY,
    endpoint: args.endpoint || process.env.RUNNING_LOCALLY ? process.env.STORAGE_S3_ENDPOINT_PUBLIC : process.env.STORAGE_S3_ENDPOINT_PRIVATE,
    sslEnabled: true
  };
  if (args.secretAccessKey && args.accessKeyId) {
    // override our default values with received arguments.
    payload.accessKeyId = args.accessKeyId;
    payload.secretAccessKey = args.secretAccessKey;
  }
  const hashKey = keys.md5(JSON.stringify(payload));
  const instance = awsInstance[hashKey];
  if (instance) { console.log('returning cached s3 instance'); return instance; };
  const s3 = new AWS.S3(payload);
  awsInstance[hashKey] = s3;
  console.log('returning new s3 instance');
  return s3;
};

const initiateS3 = async function(args) {
  const s3Payload = {
    maxAsyncS3: 20, // this is the default
    s3RetryCount: 3, // this is the default
    s3RetryDelay: 1000, // this is the default
    multipartUploadThreshold: 20971520, // this is the default (20 MB)
    multipartUploadSize: 15728640, // this is the default (15 MB)
    s3Options: {
      region: 'eu-standard',
      endpoint: process.env.RUNNING_LOCALLY ? process.env.STORAGE_S3_ENDPOINT_PUBLIC : process.env.STORAGE_S3_ENDPOINT_PRIVATE,
      sslEnabled: true,
      accessKeyId: process.env.STORAGE_S3_ACCESSKEY,
      secretAccessKey: process.env.STORAGE_S3_SECRETACCESSKEY,
      params: {
        Bucket: args.bucket || process.env.STORAGE_S3_BUCKET
      }
    }
  };
  const hashKey = keys.md5(JSON.stringify(s3Payload));
  console.log('storage-s3->initiateS3');
  let instance = bucketInstances[hashKey];
  console.log('storage-s3->cached instances', instance ? true : false);
  if (instance) {
    return instance;
  };
  console.log('storage-s3->creating new instance');
  const newPayload = s3Payload;
  if (args) { // acho isto errado, acho que n se deve reutilizar a instance se tiver params de inicialização diferentes
    Object.assign(newPayload.s3Options, args);
  }
  instance = s3.createClient(newPayload);
  console.log('storage-s3->created instance, adding to cache');
  bucketInstances[hashKey] = instance;
  console.log('storage-s3->returning instance');
  return instance;
};

const s3Actions = {
  list: async function(args) {
    let data = { Contents: [] };
    do {
      const d = await this._list(args);
      args.marker = d.NextMarker;
      d.Contents = data.Contents.concat(d.Contents);
      data = d;
    } while (data.IsTruncated === true);
    return data;
  },
  _list: function(args) {
    return new Promise((resolve, reject) => {
      const client = initiateS3(args);
      client.then(instance => {
        if (!instance) {
          reject(new Error('no instance created'));
        }
        const prefix = args.key ? args.key : '';
        const delimiter = '/';
        // suportar maker e maxkeys
        const marker = args.marker;
        const maxkeys = args.maxkeys || 1000;

        const params = {
          s3Params: {
            Bucket: args.bucket ? args.bucket : process.env.STORAGE_S3_BUCKET,
            Delimiter: delimiter,
            Prefix: prefix,
            Marker: marker,
            MaxKeys: maxkeys
          }
        };
        try {
          const obj = instance.listObjects(params, function(err, data) {
            if (err) {
              console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', err);
              return reject(err);
            }
          });
          obj.on('data', data => {
            // console.log(process.env.__OW_ACTIVATION_ID,data)
            resolve(data);
          });
          obj.on('error', err => {
            console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', err);
            reject(new Error(err));
          });
        } catch (e) {
          console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', e);
          reject(e);
        }
      });
    });
  },
  read: function(args) {
    return new Promise((resolve, reject) => {
      console.log('storage-s3->read->', 'initiateS3');
      const client = initiateS3(args);
      client.then(instance => {
        console.log('storage-s3->read->Using instance:', instance);
        const params = {
          localFile: args.fileName ? './' + args.fileName : './tmp',
          /* './localStorage/' + args.key */
          s3Params: {
            Bucket: args.bucket ? args.bucket : process.env.STORAGE_S3_BUCKET,
            Key: args.key
          }
        };
        try {
          console.log('storage-s3->read->', 'read params:', params);
          console.log('storage-s3->read->', 'downloading file to', params.localFile);
          const obj = instance.downloadFile(params, function(err, data) {
            console.log({params, err, data})
            if (err) {
              console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', err);
              return reject(err);
            }
          });
          obj.on('end', data => {
            console.log('storage-s3->read->', 'file downloaded');
            // console.log('ON END DATA', data);
            // console.log('args.key', args.key);
            // let bufferType = args.key.match(/(\.png|\.jpg|\.jpeg|\.mp4|\.avi|\.mpg)$/) ? 'base64' : 'utf8';
            const bufferType = args.bufferType || args.key.match(/(\.pdf|\.png|\.jpg|\.jpeg|\.mp4|\.avi|\.mpg|\.sln)$/) ? 'base64' : 'utf8';
            // console.log(process.env.__OW_ACTIVATION_ID, 'storage-s3->Buffer is', bufferType);
            if (bufferType === 'base64') {
              data = fs.readFileSync(params.localFile, bufferType);
            } else {
              data = fs.readFileSync(params.localFile);
            }
            console.log('storage-s3->read->', 'data read from local file');
            // console.log(process.env.__OW_ACTIVATION_ID, 'storage-s3->File stored at ' + params.localFile);
            // console.log('DATA IS', data);
            if (!args.fileName || (args.fileName && !args.dontdelete)) {
              console.log('storage-s3->read->', 'deleting local file');
              fs.unlinkSync(params.localFile);
            }
            console.log('storage-s3->read->', 'returning file data');
            resolve({
              result: data
            });
          });
          obj.on('error', err => {
            console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', err);
            reject(new Error(err));
          });
        } catch (e) {
          console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', e);
          reject(e);
        }
      });
    });
  },
  write: function(args) {
    return new Promise((resolve, reject) => {
      try {
        console.log('storage-s3->write->', 'initiateS3');
        const client = initiateS3(args);
        client.then(instance => {
          console.log(process.env.__OW_ACTIVATION_ID, 'storage-s3->writing', args.key, new Date().toString());
          let localFile = null;
          const tmpHash = (new Date()).valueOf().toString();
          console.log(process.env.__OW_ACTIVATION_ID, 'storage-s3->writing local file');
          const contentType = mime.lookup(args.key) || 'application/octet-stream';
          console.log(process.env.__OW_ACTIVATION_ID, 'storage-s3->contentType', contentType);
          let encoding = args.bufferType; // por defeito é o do payload
          if (encoding == null) {
            if (args.key.match(/(\.pdf|\.png|\.jpg|\.jpeg|\.mp4|\.avi|\.mpg|\.sln)$/)) {
              encoding = 'base64';
            } else {
              encoding = 'utf8';
            }
          }
          let buffer = Buffer.from(args.data, encoding);
          localFile = ('./' + tmpHash);
          fs.writeFileSync(localFile, buffer);

          console.log(process.env.__OW_ACTIVATION_ID, 'storage-s3->uploading file');

          const params = {
            localFile: localFile,
            s3Params: {
              Bucket: args.bucket ? args.bucket : process.env.STORAGE_S3_BUCKET,
              Key: args.key,
              ACL: args.acl || 'private', // write private files, only owner can get it
              ContentType: contentType
            }
          };
          try {
            const uploader = instance.uploadFile(params);
            uploader.on('error', err => {
              console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', 'Error uploading data: ', err);
              fs.unlinkSync(localFile);
              reject(err);
            });
            uploader.on('end', () => {
              console.log(process.env.__OW_ACTIVATION_ID, new Date().toString(), 'Successfully uploaded ' + params.s3Params.Key + ' to bucket ' + params.s3Params.Bucket + '.');
              console.log(process.env.__OW_ACTIVATION_ID, 'storage-s3->deleting local file');
              fs.unlinkSync(localFile);
              console.log(process.env.__OW_ACTIVATION_ID, 'storage-s3->deleted local file, resolving');
              return resolve({
                result: 'Successfully uploaded ' + params.s3Params.Key + ' to bucket ' + params.s3Params.Bucket + '.'
              });
            });
          } catch (e) {
            console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', e);
            reject(e);
          }
        }).catch((e) => {
          console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', e);
          reject(e);
        });
      } catch (e) {
        console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', e);
        reject(e);
      }
    });
  },
  remove: function(args) {
    return new Promise((resolve, reject) => {
      const client = initiateS3(args);
      client.then(instance => {
        const params = {
          Bucket: args.bucket || process.env.STORAGE_S3_BUCKET,
          Delete: {
            Objects: args.key
          }
        };
        try {
          const obj = instance.deleteObjects(params, function(err, data) {
            if (err) {
              console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', err);
              reject(err);
            }
          });
          obj.on('end', data => {
            // console.log(process.env.__OW_ACTIVATION_ID,data)
            resolve({
              result: 'File(s) deleted'
            });
          });
          obj.on('error', err => {
            console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', err);
            reject(new Error(err));
          });
        } catch (e) {
          console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', e);
          reject(e);
        }
      });
    });
  },
  getSignedUploadLink: function(args) {
    return new Promise((resolve, reject) => {
      const params = {
        Bucket: args.bucket || process.env.STORAGE_S3_BUCKET, // Bucket
        Key: args.key, // Image url
        Expires: args.expire || 10 * 60 // Default Expire time (10 min)
      };
      args.endpoint = args.endpoint || process.env.STORAGE_S3_ENDPOINT_PUBLIC;
      // Create S3 instance
      const s3 = initiateAWSS3(args);

      // Get Url
      s3.getSignedUrl('putObject', params, (err, url) => {
        // If there is an error, reject the Promise
        if (err) {
          return reject(err);
        } else {
          // Resolve the Promise
          return resolve({ result: url.replace('.private', '') });
        }
      });
    });
  },
  getSignedLink: function(args) {
    return new Promise((resolve, reject) => {
      const params = {
        Bucket: args.bucket || process.env.STORAGE_S3_BUCKET, // Bucket
        Key: args.key, // Image url
        Expires: args.expire || 10 * 60 // Default Expire time (10 min)
      };
      args.endpoint = args.endpoint || process.env.STORAGE_S3_ENDPOINT_PUBLIC;
      // Create S3 instance
      const s3 = initiateAWSS3(args);

      // Get Url
      s3.getSignedUrl('getObject', params, (err, url) => {
        // If there is an error, reject the Promise
        if (err) {
          return reject(err);
        } else {
          // Resolve the Promise
          return resolve({ result: url.replace('.private', '') });
        }
      });
    });
  },
  fileVerifier: function(args) {
    return new Promise((resolve, reject) => {
      console.log('storage-s3->fileVerifier', 'start');
      try {
        const params = {
          Bucket: args.bucket || process.env.STORAGE_S3_BUCKET,
          Key: args.key
        };
        // Create S3 instance
        console.log('storage-s3->fileVerifier', 'initiateAWSS3');
        const s3 = initiateAWSS3(args);
        console.log('storage-s3->fileVerifier', 's3 initiated');
        console.log({ params });
        // Get Url
        s3.headObject(params, (err, metadata) => {
          console.log('headObject', { err, metadata });
          // If there is an error, reject the Promise
          if (err) {
            return reject(err);
            // return reject(err);
          } else {
            // Resolve the Promise
            return resolve({ result: metadata });
          }
        });
      } catch (e) {
        console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', e);
        reject(e);
      };
    });
  },

  writeStream: function(args) {
    return new Promise((resolve, reject) => {
      try {
        const pass = new stream.PassThrough();
        const s3 = initiateAWSS3(args);

        const params = { Bucket: process.env.STORAGE_S3_BUCKET, Key: args.key, Body: pass };

        /*
        s3.upload(params, function(err, data) {
          console.log(err, data);
        });

        */
        s3.upload(params)
          .on('httpUploadProgress', progress => {
            console.log('progress', progress);
          })
          .send((err, data) => {
            if (err) {
              pass.destroy(err);
              throw (err);
            } else {
              console.log(`File uploaded and available at ${data.Location}`);
              pass.destroy();
            }
          });

        resolve(pass);
      } catch (e) {
        reject(e);
      }
    });
  }
};
// function
const storageS3 = async function(args) {
  console.log(process.env.__OW_ACTIVATION_ID, 'storage-s3->Activation Request');
  args.key = args.key ? parseUrl(args.key) : args.key;
  if (!args || !args.type) {
    throw (new Error('invalid request'));
  }
  console.log('Activation Calling StorageS3', args.requestActivation);
  try {
    return await s3Actions[args.type](args);
  } catch (e) {
    console.error(process.env.__OW_ACTIVATION_ID, 'storage-s3->', e);
    throw (e);
  }
};

const config = {
  memory: 256,
  timeout: 50000,
  logsize: 10
};

module.exports = storageS3;
module.exports.config = config;