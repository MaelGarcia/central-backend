const { testService } = require('../setup');
const { sql } = require('slonik');
const testData = require('../../data/xml');
const { dissocPath, identity } = require('ramda');

// NOTE: for the data output tests, we do not attempt to extensively determine if every
// internal case is covered; there are already two layers of tests below these, at
// test/unit/data/json, then test/unit/formats/odata. here we simply attempt to verify
// that we have plumbed the relevant input to those layers correctly, and have applied
// the appropriate higher-level logics (notfound, notauthorized, etc.)

describe('api: /forms/:id.svc', () => {
  describe('GET', () => {
    it('should reject unless the form exists', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent.svc').expect(404))));

    it('should reject unless the form is published', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple2.svc')
            .expect(404)))));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple.svc').expect(403))));

    it('should return an OData service document', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc')
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata',
              value: [
                { name: 'Submissions', kind: 'EntitySet', url: 'Submissions' },
                { name: 'Submissions.children.child', kind: 'EntitySet', url: 'Submissions.children.child' }
              ]
            });
          }))));

    it('should set the appropriate response headers', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc')
          .expect(200)
          .then(({ headers }) => {
            headers['odata-version'].should.equal('4.0');
            headers['content-type'].should.equal('application/json; charset=utf-8; odata.metadata=minimal');
          }))));
  });

  describe('/$metadata GET', () => {
    it('should reject unless the form exists', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent.svc/$metadata')
          .expect(404)
          .then(({ headers, text }) => {
            headers['content-type'].should.equal('text/xml; charset=utf-8');
            text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
<error code="404.1">
  <message>Could not find the resource you were looking for.</message>
  <details></details>
</error>`);
          }))));

    it('should reject unless the form is published', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple2.svc/$metadata')
            .expect(404)))));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple.svc/$metadata')
          .expect(403)
          .then(({ headers, text }) => {
            headers['content-type'].should.equal('text/xml; charset=utf-8');
            text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
<error code="403.1">
  <message>The authentication you provided does not have rights to perform that action.</message>
  <details></details>
</error>`);
          }))));

    it('should return an EDMX metadata document', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple.svc/$metadata')
          .expect(200)
          .then(({ text }) => {
            text.should.startWith('<?xml version="1.0" encoding="UTF-8"?>\n<edmx:Edmx');
          }))));
  });

  describe('/Submissions(id)/… GET', () => {
    it('should reject unless the form exists', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get("/v1/projects/1/forms/nonexistent.svc/Submissions('xyz')").expect(404))));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get("/v1/projects/1/forms/simple.svc/Submissions('xyz')").expect(403))));

    const withSubmission = (service, callback) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.doubleRepeat)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/submissions?deviceID=testid')
            .send(testData.instances.doubleRepeat.double)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => callback(asAlice))));

    it('should reject if the submission does not exist', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('nonexistent')").expect(404))));

    it('should return a single row result', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')")
          .expect(200)
          .then(({ body }) => {
            // have to manually check and clear the date for exact match:
            body.value[0].__system.submissionDate.should.be.an.isoDate();
            // eslint-disable-next-line no-param-reassign
            delete body.value[0].__system.submissionDate;

            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions',
              value: [{
                __id: 'double',
                __system: {
                  // submissionDate is checked above!
                  updatedAt: null,
                  submitterId: '5',
                  submitterName: 'Alice',
                  attachmentsPresent: 0,
                  attachmentsExpected: 0,
                  status: null,
                  reviewState: null,
                  deviceId: 'testid',
                  edits: 0,
                  formVersion: '1.0'
                },
                children: {
                  'child@odata.navigationLink': "Submissions('double')/children/child"
                },
                meta: { instanceID: 'double' },
                name: 'Vick'
              }]
            });
          }))));

    it('should return success if "uuid:" prefix is encoded', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.doubleRepeat)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/submissions')
            .send(testData.instances.doubleRepeat.double.replace(
              '<orx:instanceID>double</orx:instanceID>',
              '<orx:instanceID>uuid:17b09e96-4141-43f5-9a70-611eb0e8f6b4</orx:instanceID>'
            ))
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('uuid%3A17b09e96-4141-43f5-9a70-611eb0e8f6b4')")
              .expect(200))))));

    it('should return an accurate edit count', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.put('/v1/projects/1/forms/doubleRepeat/submissions/double')
          .send(testData.instances.doubleRepeat.double.replace(
            'double</orx', 'double2</orx:instanceID><orx:deprecatedID>double</orx:deprecatedID>')) // eslint-disable-line function-paren-newline
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')")
            .expect(200)
            .then(({ body }) => {
              body.value[0].__system.edits.should.equal(1);
            })))));

    it('should return a single encrypted frame (no formdata)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get("/v1/projects/1/forms/encrypted.svc/Submissions('uuid:dcf4a151-5088-453f-99e6-369d67828f7a')")
            .expect(200)
            .then(({ body }) => {
              // have to manually check and clear the date for exact match:
              body.value[0].__system.submissionDate.should.be.an.isoDate();
              // eslint-disable-next-line no-param-reassign
              delete body.value[0].__system.submissionDate;

              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/encrypted.svc/$metadata#Submissions',
                value: [{
                  __id: 'uuid:dcf4a151-5088-453f-99e6-369d67828f7a',
                  __system: {
                    // submissionDate is checked above!
                    updatedAt: null,
                    submitterId: '5',
                    submitterName: 'Alice',
                    attachmentsPresent: 0,
                    attachmentsExpected: 2,
                    status: 'missingEncryptedFormData',
                    reviewState: null,
                    deviceId: null,
                    edits: 0,
                    formVersion: 'working3'
                  }
                }]
              });
            })))));

    it('should return a single encrypted frame (has formdata)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions/uuid:dcf4a151-5088-453f-99e6-369d67828f7a/attachments/submission.xml.enc')
            .send('encrypted data')
            .expect(200))
          .then(() => asAlice.get("/v1/projects/1/forms/encrypted.svc/Submissions('uuid:dcf4a151-5088-453f-99e6-369d67828f7a')")
            .expect(200)
            .then(({ body }) => {
              // have to manually check and clear the date for exact match:
              body.value[0].__system.submissionDate.should.be.an.isoDate();
              // eslint-disable-next-line no-param-reassign
              delete body.value[0].__system.submissionDate;

              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/encrypted.svc/$metadata#Submissions',
                value: [{
                  __id: 'uuid:dcf4a151-5088-453f-99e6-369d67828f7a',
                  __system: {
                    // submissionDate is checked above!
                    updatedAt: null,
                    submitterId: '5',
                    submitterName: 'Alice',
                    attachmentsPresent: 1,
                    attachmentsExpected: 2,
                    status: 'notDecrypted',
                    reviewState: null,
                    deviceId: null,
                    edits: 0,
                    formVersion: 'working3'
                  }
                }]
              });
            })))));

    it('should return subtable results', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')/children/child")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions.children.child',
              value: [{
                __id: '46ebf42ee83ddec5028c42b2c054402d1e700208',
                '__Submissions-id': 'double',
                name: 'Alice',
                toys: {}
              }, {
                __id: 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                '__Submissions-id': 'double',
                name: 'Bob',
                toys: {
                  'toy@odata.navigationLink': "Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy"
                }
              }, {
                __id: '8954b393f82c1833abb19be08a3d6cb382171f54',
                '__Submissions-id': 'double',
                name: 'Chelsea',
                toys: {
                  'toy@odata.navigationLink': "Submissions('double')/children/child('8954b393f82c1833abb19be08a3d6cb382171f54')/toys/toy"
                }
              }]
            });
          }))));

    it('should limit and offset subtable results', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')/children/child?$top=1&$skip=1")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions.children.child',
              '@odata.nextLink': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/Submissions(%27double%27)/children/child?%24skip=2',
              value: [{
                __id: 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                '__Submissions-id': 'double',
                name: 'Bob',
                toys: {
                  'toy@odata.navigationLink': "Submissions('double')/children/child('b6e93a81a53eed0566e65e472d4a4b9ae383ee6d')/toys/toy"
                }
              }]
            });
          }))));

    it('should return just a count if asked', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')/children/child?$top=0&$count=true")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions.children.child',
              '@odata.nextLink': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/Submissions(%27double%27)/children/child?%24count=true&%24skip=0',
              '@odata.count': 3,
              value: []
            });
          }))));

    // HACK: this test sort of relies on some trickery to make the backend
    // thing the submission is encrypted even though it isn't (see the replace
    // call). there is some chance this methodology is fragile. (mark1)
    it('should gracefully degrade on encrypted subtables', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.doubleRepeat)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/submissions')
            .send(testData.instances.doubleRepeat.double.replace('</data>',
              '<encryptedXmlFile>x</encryptedXmlFile><base64EncryptedKey>y</base64EncryptedKey></data>'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')/children/child")
            .expect(200)
            .then(({ body }) => {
              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions.children.child',
                value: []
              });
            })))));

    it('should return encoded URLs', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.doubleRepeat.replace(
            'id="doubleRepeat"',
            'id="double repeat"'
          ))
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/double%20repeat/submissions')
            .send(testData.instances.doubleRepeat.double
              .replace('id="doubleRepeat"', 'id="double repeat"')
              .replace(
                '<orx:instanceID>double</orx:instanceID>',
                '<orx:instanceID>uuid:17b09e96-4141-43f5-9a70-611eb0e8f6b4</orx:instanceID>'
              ))
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => Promise.all([
              asAlice.get("/v1/projects/1/forms/double%20repeat.svc/Submissions('uuid%3A17b09e96-4141-43f5-9a70-611eb0e8f6b4')")
                .expect(200)
                .then(({ body }) => {
                  body.should.containDeep({
                    '@odata.context': 'http://localhost:8989/v1/projects/1/forms/double%20repeat.svc/$metadata#Submissions',
                    value: [{
                      children: {
                        'child@odata.navigationLink': "Submissions('uuid%3A17b09e96-4141-43f5-9a70-611eb0e8f6b4')/children/child"
                      }
                    }]
                  });
                }),
              asAlice.get("/v1/projects/1/forms/double%20repeat.svc/Submissions('uuid%3A17b09e96-4141-43f5-9a70-611eb0e8f6b4')/children/child?$top=1")
                .expect(200)
                .then(({ body }) => {
                  body['@odata.nextLink'].should.equal('http://localhost:8989/v1/projects/1/forms/double%20repeat.svc/Submissions(%27uuid%3A17b09e96-4141-43f5-9a70-611eb0e8f6b4%27)/children/child?%24skip=1');
                })
            ]))))));

    it('should return a single row result with all properties', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')?$select=*")
          .expect(200)
          .then(({ body }) => {
            // have to manually check and clear the date for exact match:
            body.value[0].__system.submissionDate.should.be.an.isoDate();
            const bodyWithoutSubmissionDate = dissocPath(['value', 0, '__system', 'submissionDate'], body);

            bodyWithoutSubmissionDate.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions',
              value: [{
                __id: 'double',
                __system: {
                  // submissionDate is checked above!
                  updatedAt: null,
                  submitterId: '5',
                  submitterName: 'Alice',
                  attachmentsPresent: 0,
                  attachmentsExpected: 0,
                  status: null,
                  reviewState: null,
                  deviceId: 'testid',
                  edits: 0,
                  formVersion: '1.0'
                },
                children: {
                  'child@odata.navigationLink': "Submissions('double')/children/child"
                },
                meta: { instanceID: 'double' },
                name: 'Vick'
              }]
            });
          }))));

    it('should return a single row result with selected properties', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')?$select=__id,__system/submissionDate,__system/status,name,meta/instanceID,children/child")
          .expect(200)
          .then(({ body }) => {
            // have to manually check and clear the date for exact match:
            body.value[0].__system.submissionDate.should.be.an.isoDate();
            const bodyWithoutSubmissionDate = dissocPath(['value', 0, '__system', 'submissionDate'], body);

            bodyWithoutSubmissionDate.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions',
              value: [{
                __id: 'double',
                __system: {
                  // submissionDate is checked above!
                  status: null
                },
                children: {
                  'child@odata.navigationLink': "Submissions('double')/children/child"
                },
                meta: { instanceID: 'double' },
                name: 'Vick'
              }]
            });
          }))));

    it('should return a single row result with all system properties', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')?$select=__system")
          .expect(200)
          .then(({ body }) => {
            // have to manually check and clear the date for exact match:
            body.value[0].__system.submissionDate.should.be.an.isoDate();
            const bodyWithoutSubmissionDate = dissocPath(['value', 0, '__system', 'submissionDate'], body);

            bodyWithoutSubmissionDate.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions',
              value: [{
                __system: {
                  // submissionDate is checked above!
                  updatedAt: null,
                  submitterId: '5',
                  submitterName: 'Alice',
                  attachmentsPresent: 0,
                  attachmentsExpected: 0,
                  status: null,
                  reviewState: null,
                  deviceId: 'testid',
                  edits: 0,
                  formVersion: '1.0'
                }
              }]
            });
          }))));

    it('should return subtable results with selected properties', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')/children/child('8954b393f82c1833abb19be08a3d6cb382171f54')/toys/toy?$select=name")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions.children.child.toys.toy',
              value: [{
                name: 'Rainbow Dash'
              }, {
                name: 'Rarity'
              }, {
                name: 'Fluttershy'
              }, {
                name: 'Princess Luna'
              }]
            });
          }))));

    it('should not return parent IDs if __id is selected', testService((service) =>
      withSubmission(service, (asAlice) =>
        asAlice.get("/v1/projects/1/forms/doubleRepeat.svc/Submissions('double')/children/child?$select=__id,name")
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions.children.child',
              value: [{
                __id: '46ebf42ee83ddec5028c42b2c054402d1e700208',
                name: 'Alice',
              },
              {
                __id: 'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d',
                name: 'Bob',
              },
              {
                __id: '8954b393f82c1833abb19be08a3d6cb382171f54',
                name: 'Chelsea'
              }]
            });
          }))));

    it('should return only parent ID', testService(async (service) => {
      const asAlice = await withSubmission(service, identity);

      await asAlice.get('/v1/projects/1/forms/doubleRepeat.svc/Submissions(\'double\')/children/child(\'b6e93a81a53eed0566e65e472d4a4b9ae383ee6d\')/toys/toy?$select=__Submissions-children-child-id')
        .expect(200)
        .then(({ body }) => {
          body.value.forEach(toy => toy.should.have.property('__Submissions-children-child-id'));
        });

    }));
  });

  describe('/Submissions.xyz.* GET', () => {
    it('should reject unless the form exists', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/nonexistent.svc/Submissions').expect(404))));

    it('should reject unless the form is published', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simple2)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.get('/v1/projects/1/forms/simple2.svc/Submissions')
            .expect(404)))));

    it('should reject unless the user can read', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple.svc/Submissions').expect(403))));

    const withSubmissions = (service, callback) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
          .send(testData.instances.withrepeat.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.two)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
              .send(testData.instances.withrepeat.three)
              .set('Content-Type', 'text/xml')
              .expect(200)
              .then(() => callback(asAlice)))));

    it('should return toplevel rows', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions')
          .expect(200)
          .then(({ body }) => {
            for (const idx of [ 0, 1, 2 ]) {
              body.value[idx].__system.submissionDate.should.be.an.isoDate();
              // eslint-disable-next-line no-param-reassign
              delete body.value[idx].__system.submissionDate;
            }

            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
              value: [{
                __id: 'rthree',
                __system: {
                  // submissionDate is checked above,
                  updatedAt: null,
                  submitterId: '5',
                  submitterName: 'Alice',
                  attachmentsPresent: 0,
                  attachmentsExpected: 0,
                  status: null,
                  reviewState: null,
                  deviceId: null,
                  edits: 0,
                  formVersion: '1.0'
                },
                meta: { instanceID: 'rthree' },
                name: 'Chelsea',
                age: 38,
                children: {
                  'child@odata.navigationLink': "Submissions('rthree')/children/child"
                }
              }, {
                __id: 'rtwo',
                __system: {
                  // submissionDate is checked above,
                  updatedAt: null,
                  submitterId: '5',
                  submitterName: 'Alice',
                  attachmentsPresent: 0,
                  attachmentsExpected: 0,
                  status: null,
                  reviewState: null,
                  deviceId: null,
                  edits: 0,
                  formVersion: '1.0'
                },
                meta: { instanceID: 'rtwo' },
                name: 'Bob',
                age: 34,
                children: {
                  'child@odata.navigationLink': "Submissions('rtwo')/children/child"
                }
              }, {
                __id: 'rone',
                __system: {
                  // submissionDate is checked above,
                  updatedAt: null,
                  submitterId: '5',
                  submitterName: 'Alice',
                  attachmentsPresent: 0,
                  attachmentsExpected: 0,
                  status: null,
                  reviewState: null,
                  deviceId: null,
                  edits: 0,
                  formVersion: '1.0'
                },
                meta: { instanceID: 'rone' },
                name: 'Alice',
                age: 30,
                children: {}
              }]
            });
          }))));

    it('should return a count even if there are no rows', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$count=true')
          .expect(200)
          .then(({ body }) => {
            body['@odata.count'].should.equal(0);
          }))));

    it('should return subtable results', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions.children.child')
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions.children.child',
              value: [{
                __id: '32809ae2b3dc404ea292205eb884b21fa4e9acc5',
                '__Submissions-id': 'rthree',
                name: 'Candace',
                age: 2
              }, {
                __id: '52eff9ea82550183880b9d64c20487642fa6e60c',
                '__Submissions-id': 'rtwo',
                name: 'Billy',
                age: 4
              }, {
                __id: '1291953ccbe2e5e866f7ab3fefa3036d649186d3',
                '__Submissions-id': 'rtwo',
                name: 'Blaine',
                age: 6
              }]
            });
          }))));

    it('should limit and offset toplevel rows', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$top=1&$skip=1')
          .expect(200)
          .then(({ body }) => {
            body.value[0].__system.submissionDate.should.be.an.isoDate();
            // eslint-disable-next-line no-param-reassign
            delete body.value[0].__system.submissionDate;

            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
              '@odata.nextLink': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/Submissions?%24skip=2',
              value: [{
                __id: 'rtwo',
                __system: {
                  // submissionDate is checked above,
                  updatedAt: null,
                  submitterId: '5',
                  submitterName: 'Alice',
                  attachmentsPresent: 0,
                  attachmentsExpected: 0,
                  status: null,
                  reviewState: null,
                  deviceId: null,
                  edits: 0,
                  formVersion: '1.0'
                },
                meta: { instanceID: 'rtwo' },
                name: 'Bob',
                age: 34,
                children: {
                  'child@odata.navigationLink': "Submissions('rtwo')/children/child"
                }
              }]
            });
          }))));

    it('should provide toplevel row count if requested', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$top=1&$count=true')
          .expect(200)
          .then(({ body }) => {
            body.value[0].__system.submissionDate.should.be.an.isoDate();
            // eslint-disable-next-line no-param-reassign
            delete body.value[0].__system.submissionDate;

            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
              '@odata.nextLink': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/Submissions?%24count=true&%24skip=1',
              '@odata.count': 3,
              value: [{
                __id: 'rthree',
                __system: {
                  // submissionDate is checked above,
                  updatedAt: null,
                  submitterId: '5',
                  submitterName: 'Alice',
                  attachmentsPresent: 0,
                  attachmentsExpected: 0,
                  status: null,
                  reviewState: null,
                  deviceId: null,
                  edits: 0,
                  formVersion: '1.0'
                },
                meta: { instanceID: 'rthree' },
                name: 'Chelsea',
                age: 38,
                children: {
                  'child@odata.navigationLink': "Submissions('rthree')/children/child"
                }
              }]
            });
          }))));

    it('should return submitter-filtered toplevel rows if requested', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('bob', (asBob) =>
          asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.one)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asBob.post('/v1/projects/1/forms/withrepeat/submissions')
              .send(testData.instances.withrepeat.two)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
              .send(testData.instances.withrepeat.three)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.one)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$filter=__system/submitterId eq 5')
              .expect(200)
              .then(({ body }) => {
                for (const idx of [ 0, 1 ]) {
                  body.value[idx].__system.submissionDate.should.be.an.isoDate();
                  // eslint-disable-next-line no-param-reassign
                  delete body.value[idx].__system.submissionDate;
                }

                body.should.eql({
                  '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
                  value: [{
                    __id: 'rthree',
                    __system: {
                      // submissionDate is checked above,
                      updatedAt: null,
                      submitterId: '5',
                      submitterName: 'Alice',
                      attachmentsPresent: 0,
                      attachmentsExpected: 0,
                      status: null,
                      reviewState: null,
                      deviceId: null,
                      edits: 0,
                      formVersion: '1.0'
                    },
                    meta: { instanceID: 'rthree' },
                    name: 'Chelsea',
                    age: 38,
                    children: {
                      'child@odata.navigationLink': "Submissions('rthree')/children/child"
                    }
                  }, {
                    __id: 'rone',
                    __system: {
                      // submissionDate is checked above,
                      updatedAt: null,
                      submitterId: '5',
                      submitterName: 'Alice',
                      attachmentsPresent: 0,
                      attachmentsExpected: 0,
                      status: null,
                      reviewState: null,
                      deviceId: null,
                      edits: 0,
                      formVersion: '1.0'
                    },
                    meta: { instanceID: 'rone' },
                    name: 'Alice',
                    age: 30,
                    children: {}
                  }]
                });
              }))))));

    it('should return submissionDate-filtered toplevel rows if requested', testService((service, { run }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
          .send(testData.instances.withrepeat.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => run(sql`update submissions set "createdAt"='2010-06-01T00:00:00.000Z'`))
          .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$filter=__system/submissionDate lt 2015-01-01')
            .expect(200)
            .then(({ body }) => {
              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
                value: [{
                  __id: 'rone',
                  __system: {
                    submissionDate: '2010-06-01T00:00:00.000Z',
                    updatedAt: null,
                    submitterId: '5',
                    submitterName: 'Alice',
                    attachmentsPresent: 0,
                    attachmentsExpected: 0,
                    status: null,
                    reviewState: null,
                    deviceId: null,
                    edits: 0,
                    formVersion: '1.0'
                  },
                  meta: { instanceID: 'rone' },
                  name: 'Alice',
                  age: 30,
                  children: {}
                }]
              });
            })))));

    // #cb459: `gt` filter for submissionDate is not working as expected because of tz precision
    // This test fails without 20221208-01-reduce-tz-precision.js (before-after state)
    it('should only return submissions with submissionDate gt provided timestamp', testService(async (service, { run }) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
        .send(testData.instances.withrepeat.one)
        .set('Content-Type', 'text/xml')
        .expect(200);

      // Ensure that microsecond does not ends at 000 - In that case existing code is working correctly
      await run(sql`update submissions set "createdAt"=date_trunc('milliseconds', "createdAt") + interval '1 microseconds'`);

      const lastTimestamp = await asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions')
        .expect(200)
        .then(({ body }) => body.value[0].__system.submissionDate);

      await asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
        .send(testData.instances.withrepeat.two)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.get(`/v1/projects/1/forms/withrepeat.svc/Submissions?$filter=__system/submissionDate gt ${lastTimestamp}`)
        .expect(200)
        .then(({ body }) => {
          body.value.length.should.be.eql(1);
          body.value[0].__id.should.be.eql('rtwo');
        });
    }));

    it('should return submissionDate-filtered toplevel rows with a function', testService((service, { run }) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
          .send(testData.instances.withrepeat.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => run(sql`update submissions set "createdAt"='2010-06-01T00:00:00.000Z'`))
          .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$filter=year(__system/submissionDate) eq 2010')
            .expect(200)
            .then(({ body }) => {
              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
                value: [{
                  __id: 'rone',
                  __system: {
                    submissionDate: '2010-06-01T00:00:00.000Z',
                    updatedAt: null,
                    submitterId: '5',
                    submitterName: 'Alice',
                    attachmentsPresent: 0,
                    attachmentsExpected: 0,
                    status: null,
                    reviewState: null,
                    deviceId: null,
                    edits: 0,
                    formVersion: '1.0'
                  },
                  meta: { instanceID: 'rone' },
                  name: 'Alice',
                  age: 30,
                  children: {}
                }]
              });
            })))));

    it('should return updatedAt-filtered toplevel rows if requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
          .send(testData.instances.withrepeat.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.patch('/v1/projects/1/forms/withrepeat/submissions/rtwo')
            .send({ reviewState: 'rejected' })
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$filter=__system/updatedAt eq null')
            .expect(200)
            .then(({ body }) => {
              // have to manually check and clear the date for exact match:
              body.value[0].__system.submissionDate.should.be.an.isoDate();
              // eslint-disable-next-line no-param-reassign
              delete body.value[0].__system.submissionDate;

              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
                value: [{
                  __id: 'rone',
                  __system: {
                    updatedAt: null,
                    submitterId: '5',
                    submitterName: 'Alice',
                    attachmentsPresent: 0,
                    attachmentsExpected: 0,
                    status: null,
                    reviewState: null,
                    deviceId: null,
                    edits: 0,
                    formVersion: '1.0'
                  },
                  meta: { instanceID: 'rone' },
                  name: 'Alice',
                  age: 30,
                  children: {}
                }]
              });
            })))));

    it('should return reviewState-filtered toplevel rows if requested', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
          .send(testData.instances.withrepeat.one)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.patch('/v1/projects/1/forms/withrepeat/submissions/rtwo')
            .send({ reviewState: 'rejected' })
            .expect(200))
          .then(() => asAlice.get("/v1/projects/1/forms/withrepeat.svc/Submissions?$filter=__system/reviewState eq 'rejected'")
            .expect(200)
            .then(({ body }) => {
              // have to manually check and clear the dates for exact match:
              body.value[0].__system.submissionDate.should.be.an.isoDate();
              body.value[0].__system.updatedAt.should.be.an.isoDate();
              // eslint-disable-next-line no-param-reassign
              delete body.value[0].__system.submissionDate;
              // eslint-disable-next-line no-param-reassign
              delete body.value[0].__system.updatedAt;

              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
                value: [{
                  __id: 'rtwo',
                  __system: {
                    submitterId: '5',
                    submitterName: 'Alice',
                    attachmentsPresent: 0,
                    attachmentsExpected: 0,
                    status: null,
                    reviewState: 'rejected',
                    deviceId: null,
                    edits: 0,
                    formVersion: '1.0'
                  },
                  meta: { instanceID: 'rtwo' },
                  name: 'Bob',
                  age: 34,
                  children: {
                    'child@odata.navigationLink': "Submissions('rtwo')/children/child"
                  }
                }]
              });
            })))));

    it('should count correctly while windowing', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('bob', (asBob) =>
          asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.one)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asBob.post('/v1/projects/1/forms/withrepeat/submissions')
              .send(testData.instances.withrepeat.two)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
              .send(testData.instances.withrepeat.three)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.one)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$count=true&$top=1&$skip=1')
              .expect(200)
              .then(({ body }) => {
                body['@odata.count'].should.equal(3);
              }))))));

    it('should count correctly while filtering', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('bob', (asBob) =>
          asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.one)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asBob.post('/v1/projects/1/forms/withrepeat/submissions')
              .send(testData.instances.withrepeat.two)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
              .send(testData.instances.withrepeat.three)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.one)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$count=true&$filter=__system/submitterId eq 5')
              .expect(200)
              .then(({ body }) => {
                body['@odata.count'].should.equal(2);
              }))))));

    it('should count correctly while filtering and windowing', testService((service) =>
      service.login('alice', (asAlice) =>
        service.login('bob', (asBob) =>
          asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
            .send(testData.instances.withrepeat.one)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asBob.post('/v1/projects/1/forms/withrepeat/submissions')
              .send(testData.instances.withrepeat.two)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/submissions')
              .send(testData.instances.withrepeat.three)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions')
              .send(testData.instances.simple.one)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$count=true&$filter=__system/submitterId eq 5&$top=1&$skip=1')
              .expect(200)
              .then(({ body }) => {
                body['@odata.count'].should.equal(2);
              }))))));

    it('should return encrypted frames (no formdata)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted.svc/Submissions')
            .expect(200)
            .then(({ body }) => {
              // have to manually check and clear the date for exact match:
              body.value[0].__system.submissionDate.should.be.an.isoDate();
              // eslint-disable-next-line no-param-reassign
              delete body.value[0].__system.submissionDate;
              body.value[1].__system.submissionDate.should.be.an.isoDate();
              // eslint-disable-next-line no-param-reassign
              delete body.value[1].__system.submissionDate;

              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/encrypted.svc/$metadata#Submissions',
                value: [{
                  __id: 'uuid:99b303d9-6494-477b-a30d-d8aae8867335',
                  __system: {
                    // submissionDate is checked above!
                    updatedAt: null,
                    submitterId: '5',
                    submitterName: 'Alice',
                    attachmentsPresent: 0,
                    attachmentsExpected: 2,
                    status: 'missingEncryptedFormData',
                    reviewState: null,
                    deviceId: null,
                    edits: 0,
                    formVersion: 'working3'
                  }
                }, {
                  __id: 'uuid:dcf4a151-5088-453f-99e6-369d67828f7a',
                  __system: {
                    // submissionDate is checked above!
                    updatedAt: null,
                    submitterId: '5',
                    submitterName: 'Alice',
                    attachmentsPresent: 0,
                    attachmentsExpected: 2,
                    status: 'missingEncryptedFormData',
                    reviewState: null,
                    deviceId: null,
                    edits: 0,
                    formVersion: 'working3'
                  }
                }]
              });
            })))));

    it('should return encrypted frames (has formdata)', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.encrypted)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.one)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions/uuid:dcf4a151-5088-453f-99e6-369d67828f7a/attachments/submission.xml.enc')
            .send('encrypted data')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions')
            .send(testData.instances.encrypted.two)
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.post('/v1/projects/1/forms/encrypted/submissions/uuid:99b303d9-6494-477b-a30d-d8aae8867335/attachments/submission.xml.enc')
            .send('encrypted data')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/encrypted.svc/Submissions')
            .expect(200)
            .then(({ body }) => {
              // have to manually check and clear the date for exact match:
              body.value[0].__system.submissionDate.should.be.an.isoDate();
              // eslint-disable-next-line no-param-reassign
              delete body.value[0].__system.submissionDate;
              body.value[1].__system.submissionDate.should.be.an.isoDate();
              // eslint-disable-next-line no-param-reassign
              delete body.value[1].__system.submissionDate;

              body.should.eql({
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/encrypted.svc/$metadata#Submissions',
                value: [{
                  __id: 'uuid:99b303d9-6494-477b-a30d-d8aae8867335',
                  __system: {
                    // submissionDate is checked above!
                    updatedAt: null,
                    submitterId: '5',
                    submitterName: 'Alice',
                    attachmentsPresent: 1,
                    attachmentsExpected: 2,
                    status: 'notDecrypted',
                    reviewState: null,
                    deviceId: null,
                    edits: 0,
                    formVersion: 'working3'
                  }
                }, {
                  __id: 'uuid:dcf4a151-5088-453f-99e6-369d67828f7a',
                  __system: {
                    // submissionDate is checked above!
                    updatedAt: null,
                    submitterId: '5',
                    submitterName: 'Alice',
                    attachmentsPresent: 1,
                    attachmentsExpected: 2,
                    status: 'notDecrypted',
                    reviewState: null,
                    deviceId: null,
                    edits: 0,
                    formVersion: 'working3'
                  }
                }]
              });
            })))));

    it('should limit and offset subtable results', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions.children.child?$top=1&$skip=1')
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions.children.child',
              '@odata.nextLink': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/Submissions.children.child?%24skip=2',
              value: [{
                __id: '52eff9ea82550183880b9d64c20487642fa6e60c',
                '__Submissions-id': 'rtwo',
                name: 'Billy',
                age: 4
              }]
            });
          }))));

    // we cheat here. see mark1.
    it('should gracefully degrade on encrypted subtables', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.doubleRepeat)
          .set('Content-Type', 'text/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/submissions')
            .send(testData.instances.doubleRepeat.double.replace('</data>',
              '<encryptedXmlFile>x</encryptedXmlFile><base64EncryptedKey>y</base64EncryptedKey></data>'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => asAlice.get('/v1/projects/1/forms/doubleRepeat.svc/Submissions.children.child')
            .expect(200)
            .then(({ body }) => {
              body.should.eql({
                value: [],
                '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat.svc/$metadata#Submissions.children.child'
              });
            })))));

    it('should return toplevel rows with selected properties', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$select=__id,name')
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
              value: [{
                __id: 'rthree',
                name: 'Chelsea'
              }, {
                __id: 'rtwo',
                name: 'Bob',
              }, {
                __id: 'rone',
                name: 'Alice',
              }]
            });
          }))));

    it('should return toplevel rows with group properties', testService(async (service) => {
      const asAlice = await withSubmissions(service, identity);

      await asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions?$select=meta')
        .expect(200)
        .then(({ body }) => {
          body.should.eql({
            '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions',
            value: [
              { meta: { instanceID: 'rthree' } },
              { meta: { instanceID: 'rtwo' } },
              { meta: { instanceID: 'rone' } }
            ]
          });
        });
    }));

    it('should return toplevel row with nested group properties', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.nestedGroup)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/nestedGroup/submissions?deviceID=testid')
        .send(testData.instances.nestedGroup.one)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/nestedGroup.svc/Submissions?$select=text,hospital')
        .expect(200)
        .then(({ body }) => {
          body.should.eql({
            '@odata.context': 'http://localhost:8989/v1/projects/1/forms/nestedGroup.svc/$metadata#Submissions',
            value: [
              {
                text: 'xyz',
                hospital: {
                  name: 'AKUH',
                  hiv_medication: {
                    have_hiv_medication: 'Yes',
                  },
                },
              },
            ]
          });
        });
    }));

    it('should return subtable results with selected properties', testService((service) =>
      withSubmissions(service, (asAlice) =>
        asAlice.get('/v1/projects/1/forms/withrepeat.svc/Submissions.children.child?$select=__id,name')
          .expect(200)
          .then(({ body }) => {
            body.should.eql({
              '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat.svc/$metadata#Submissions.children.child',
              value: [{
                __id: '32809ae2b3dc404ea292205eb884b21fa4e9acc5',
                name: 'Candace'
              }, {
                __id: '52eff9ea82550183880b9d64c20487642fa6e60c',
                name: 'Billy'
              }, {
                __id: '1291953ccbe2e5e866f7ab3fefa3036d649186d3',
                name: 'Blaine'
              }]
            });
          }))));

    it('should return only parent ID', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.doubleRepeat)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/doubleRepeat/submissions')
        .send(testData.instances.doubleRepeat.double)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/doubleRepeat.svc/Submissions.children.child.toys.toy?$select=__Submissions-children-child-id')
        .expect(200)
        .then(({ body }) => {
          body.value.forEach(toy => toy.should.have.property('__Submissions-children-child-id'));
        });

    }));

    it('should return subtable results with group properties', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.groupRepeat)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/groupRepeat/submissions?deviceID=testid')
        .send(testData.instances.groupRepeat.one)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/groupRepeat.svc/Submissions.child_repeat?$select=address')
        .expect(200)
        .then(({ body }) => {
          body.should.eql({
            '@odata.context': 'http://localhost:8989/v1/projects/1/forms/groupRepeat.svc/$metadata#Submissions.child_repeat',
            value: [
              { address: { city: 'Toronto', country: 'Canada' } },
              { address: { city: 'New York', country: 'US' } }
            ]
          });
        });
    }));

    // bug cb#496 and cb#607
    it('should return results even when repeat name is not a valid OData name ', testService(async (service) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .send(`<?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:ev="http://www.w3.org/2001/xml-events" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:odk="http://www.opendatakit.org/xforms" xmlns:orx="http://openrosa.org/xforms" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
            <h:head>
                <h:title>odata_sanitize_repeat_name</h:title>
                <model odk:xforms-version="1.0.0">
                    <instance>
                        <data id="odata_sanitize_repeat_name">
                            <q1.8-test jr:template="">
                                <one/>
                            </q1.8-test>
                            <q1.8-test>
                                <one/>
                            </q1.8-test>
                            <meta>
                                <instanceID/>
                            </meta>
                        </data>
                    </instance>
                    <bind nodeset="/data/q1.8-test/one" type="int"/>
                    <bind jr:preload="uid" nodeset="/data/meta/instanceID" readonly="true()" type="string"/>
                </model>
            </h:head>
            <h:body>
                <group ref="/data/q1.8-test">
                    <label>Some repeat</label>
                    <repeat nodeset="/data/q1.8-test">
                        <input ref="/data/q1.8-test/one">
                            <label>Some int</label>
                        </input>
                    </repeat>
                </group>
            </h:body>
        </h:html>`)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/odata_sanitize_repeat_name/submissions')
        .send(`<data xmlns:jr="http://openrosa.org/javarosa" xmlns:orx="http://openrosa.org/xforms" id="odata_sanitize_repeat_name">
          <q1.8-test>
            <one>1</one>
          </q1.8-test>
          <meta>
            <instanceID>uuid:bf17f620-c56a-4533-8f89-da3f5c9bf37a</instanceID>
          </meta>
        </data>`)
        .set('Content-Type', 'text/xml')
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/odata_sanitize_repeat_name.svc')
        .expect(200)
        .then(({ body }) => {

          body.should.be.eql({
            '@odata.context': 'http://localhost:8989/v1/projects/1/forms/odata_sanitize_repeat_name.svc/$metadata',
            value: [
              {
                name: 'Submissions',
                kind: 'EntitySet',
                url: 'Submissions',
              },
              {
                name: 'Submissions.q1_8_test',
                kind: 'EntitySet',
                url: 'Submissions.q1_8_test',
              },
            ],
          });
        });

      const navLink = await asAlice.get('/v1/projects/1/forms/odata_sanitize_repeat_name.svc/Submissions')
        .expect(200)
        .then(({ body }) => {
          body.value[0]['q1_8_test@odata.navigationLink'].should.endWith('/q1_8_test');
          return body.value[0]['q1_8_test@odata.navigationLink'];
        });

      await asAlice.get(`/v1/projects/1/forms/odata_sanitize_repeat_name.svc/${navLink}`)
        .expect(200)
        .then(({ body }) => {
          body.should.be.eql({
            value: [
              {
                one: 1,
                __id: '13867da427f098fe217fc6f8f199b8ab07265043',
                '__Submissions-id': 'uuid:bf17f620-c56a-4533-8f89-da3f5c9bf37a',
              },
            ],
            '@odata.context': 'http://localhost:8989/v1/projects/1/forms/odata_sanitize_repeat_name.svc/$metadata#Submissions.q1_8_test',
          });
        });

      await asAlice.get('/v1/projects/1/forms/odata_sanitize_repeat_name.svc/Submissions.q1_8_test')
        .expect(200)
        .then(({ body }) => {
          body.should.be.eql({
            value: [
              {
                one: 1,
                __id: '13867da427f098fe217fc6f8f199b8ab07265043',
                '__Submissions-id': 'uuid:bf17f620-c56a-4533-8f89-da3f5c9bf37a',
              },
            ],
            '@odata.context': 'http://localhost:8989/v1/projects/1/forms/odata_sanitize_repeat_name.svc/$metadata#Submissions.q1_8_test',
          });
        });

    }));

  });

  describe('/draft.svc', () => {
    // as usual, we do not exahustively test all possibilities for this draft version
    // of the endpoint; we just ensure everything seems to be plumbed correctly.
    describe('GET', () => {
      it('should return not found if there is no draft', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/projects/1/forms/simple/draft.svc').expect(404))));

      it('should reject unless the user can read', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/forms/simple/draft.svc').expect(403))))));

      it('should return an OData service document', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft.svc')
              .expect(200)
              .then(({ body }) => {
                body.should.eql({
                  '@odata.context': 'http://localhost:8989/v1/projects/1/forms/simple/draft.svc/$metadata',
                  value: [
                    { name: 'Submissions', kind: 'EntitySet', url: 'Submissions' }
                  ]
                });
              })))));

      it('should return the appropriate document for the draft', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.withrepeat.replace(/withrepeat/g, 'simple'))
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft.svc')
              .expect(200)
              .then(({ body }) => {
                body.should.eql({
                  '@odata.context': 'http://localhost:8989/v1/projects/1/forms/simple/draft.svc/$metadata',
                  value: [
                    { name: 'Submissions', kind: 'EntitySet', url: 'Submissions' },
                    { name: 'Submissions.children.child', kind: 'EntitySet', url: 'Submissions.children.child' }
                  ]
                });
              })))));
    });

    describe('/$metadata GET', () => {
      it('should reject unless the draft exists', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/projects/1/forms/simple/draft.svc/$metadata').expect(404))));

      it('should reject unless the user can read', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/forms/simple/draft.svc/$metadata').expect(403))))));

      it('should return an EDMX metadata document', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple.svc/$metadata')
              .expect(200)
              .then(({ text }) => {
                text.should.startWith('<?xml version="1.0" encoding="UTF-8"?>\n<edmx:Edmx');
              })))));

      it('should return the appropriate document for the draft', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .send(testData.forms.withrepeat.replace(/withrepeat/g, 'simple'))
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple/draft.svc/$metadata')
              .expect(200)
              .then(({ text }) => {
                text.includes('<EntityType Name="Submissions.children.child">').should.equal(true);
              })))));
    });

    describe("/Submissions('xyz')", () => {
      it('should reject unless the draft exists', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get("/v1/projects/1/forms/nonexistent/draft.svc/Submissions('xyz')").expect(404))));

      it('should reject unless the user can read', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get("/v1/projects/1/forms/simple/draft.svc/Submissions('xyz')").expect(403))))));

      it('should return a single row result', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.doubleRepeat)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/draft/submissions')
              .send(testData.instances.doubleRepeat.double)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.get("/v1/projects/1/forms/doubleRepeat/draft.svc/Submissions('double')")
              .expect(200)
              .then(({ body }) => {
                // have to manually check and clear the date for exact match:
                body.value[0].__system.submissionDate.should.be.an.isoDate();
                // eslint-disable-next-line no-param-reassign
                delete body.value[0].__system.submissionDate;

                body.should.eql({
                  '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat/draft.svc/$metadata#Submissions',
                  value: [{
                    __id: 'double',
                    __system: {
                      // submissionDate is checked above!
                      updatedAt: null,
                      submitterId: '5',
                      submitterName: 'Alice',
                      attachmentsPresent: 0,
                      attachmentsExpected: 0,
                      status: null,
                      reviewState: null,
                      deviceId: null,
                      edits: 0,
                      formVersion: '1.0'
                    },
                    children: {
                      'child@odata.navigationLink': "Submissions('double')/children/child"
                    },
                    meta: { instanceID: 'double' },
                    name: 'Vick'
                  }]
                });
              })))));

      it('should not return results from the published form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.doubleRepeat)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/draft/submissions')
              .send(testData.instances.doubleRepeat.double)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/draft/publish')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/draft')
              .expect(200))
            .then(() => asAlice.get("/v1/projects/1/forms/doubleRepeat/draft.svc/Submissions('double')")
              .expect(404)))));
    });


    describe('/Submissions.xyz', () => {
      it('should reject unless the draft exists', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.get('/v1/projects/1/forms/simple/draft.svc/Submissions').expect(404))));

      it('should reject unless the user can read', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/simple/draft')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/forms/simple/draft.svc/Submissions').expect(403))))));

      it('should return toplevel rows', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms/withrepeat/draft')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/draft/submissions')
              .send(testData.instances.withrepeat.one)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/draft/submissions')
              .send(testData.instances.withrepeat.two)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withrepeat/draft/submissions')
              .send(testData.instances.withrepeat.three)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withrepeat/draft.svc/Submissions')
              .expect(200)
              .then(({ body }) => {
                for (const idx of [ 0, 1, 2 ]) {
                  body.value[idx].__system.submissionDate.should.be.an.isoDate();
                  // eslint-disable-next-line no-param-reassign
                  delete body.value[idx].__system.submissionDate;
                }

                body.should.eql({
                  '@odata.context': 'http://localhost:8989/v1/projects/1/forms/withrepeat/draft.svc/$metadata#Submissions',
                  value: [{
                    __id: 'rthree',
                    __system: {
                      // submissionDate is checked above,
                      updatedAt: null,
                      submitterId: '5',
                      submitterName: 'Alice',
                      attachmentsPresent: 0,
                      attachmentsExpected: 0,
                      status: null,
                      reviewState: null,
                      deviceId: null,
                      edits: 0,
                      formVersion: '1.0'
                    },
                    meta: { instanceID: 'rthree' },
                    name: 'Chelsea',
                    age: 38,
                    children: {
                      'child@odata.navigationLink': "Submissions('rthree')/children/child"
                    }
                  }, {
                    __id: 'rtwo',
                    __system: {
                      // submissionDate is checked above,
                      updatedAt: null,
                      submitterId: '5',
                      submitterName: 'Alice',
                      attachmentsPresent: 0,
                      attachmentsExpected: 0,
                      status: null,
                      reviewState: null,
                      deviceId: null,
                      edits: 0,
                      formVersion: '1.0'
                    },
                    meta: { instanceID: 'rtwo' },
                    name: 'Bob',
                    age: 34,
                    children: {
                      'child@odata.navigationLink': "Submissions('rtwo')/children/child"
                    }
                  }, {
                    __id: 'rone',
                    __system: {
                      // submissionDate is checked above,
                      updatedAt: null,
                      submitterId: '5',
                      submitterName: 'Alice',
                      attachmentsPresent: 0,
                      attachmentsExpected: 0,
                      status: null,
                      reviewState: null,
                      deviceId: null,
                      edits: 0,
                      formVersion: '1.0'
                    },
                    meta: { instanceID: 'rone' },
                    name: 'Alice',
                    age: 30,
                    children: {}
                  }]
                });
              })))));

      it('should not return results from the published form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.doubleRepeat)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/draft/submissions')
              .send(testData.instances.doubleRepeat.double)
              .set('Content-Type', 'text/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/draft/publish')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/doubleRepeat/draft')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/doubleRepeat/draft.svc/Submissions')
              .expect(200)
              .then(({ body }) => {
                body.should.eql({
                  '@odata.context': 'http://localhost:8989/v1/projects/1/forms/doubleRepeat/draft.svc/$metadata#Submissions',
                  value: []
                });
              })))));
    });
  });
});

