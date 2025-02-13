const appRoot = require('app-root-path');
const { testService } = require('../setup');
const testData = require('../../data/xml');
const config = require('config');
const { Form } = require('../../../lib/model/frames');
const { getOrNotFound } = require('../../../lib/util/promise');
const { omit } = require('ramda');
const should = require('should');
const { sql } = require('slonik');
const { QueryOptions } = require('../../../lib/util/db');

/* eslint-disable import/no-dynamic-require */
const { exhaust } = require(appRoot + '/lib/worker/worker');
/* eslint-enable import/no-dynamic-require */

describe('datasets and entities', () => {
  describe('listing and downloading datasets', () => {
    describe('projects/:id/datasets GET', () => {
      it('should reject if the user cannot list datasets', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/datasets')
                .expect(403))))));

      it('should return the datasets of Default project', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() =>
              asAlice.get('/v1/projects/1/datasets')
                .expect(200)
                .then(({ body }) => {
                  body[0].should.be.a.Dataset();
                  body.map(({ createdAt, ...d }) => d).should.eql([
                    { name: 'people', projectId: 1, approvalRequired: false }
                  ]);
                })))));

      it('should return the extended datasets of Default project', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body[0].should.be.an.ExtendedDataset();
            body.map(({ createdAt, lastEntity, ...d }) => d).should.eql([
              { name: 'people', projectId: 1, entities: 1, approvalRequired: false }
            ]);
          });
      }));

      it('should not return draft datasets', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity
                .replace(/simpleEntity/, 'simpleEntity2')
                .replace(/people/, 'student'))
              .expect(200)
              .then(() =>
                asAlice.get('/v1/projects/1/datasets')
                  .expect(200)
                  .then(({ body }) => {
                    body[0].should.be.a.Dataset();
                    body.map(({ id, createdAt, ...d }) => d).should.eql([
                      { name: 'student', projectId: 1, approvalRequired: false }
                    ]);
                  }))))));
    });

    describe('projects/:id/datasets GET extended', () => {

      it('should return the 0 for entities', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body[0].should.be.an.ExtendedDataset();
            body.map(({ createdAt, lastEntity, ...d }) => {
              should(lastEntity).be.null();
              return d;
            }).should.eql([
              { name: 'people', projectId: 1, entities: 0, approvalRequired: false }
            ]);
          });
      }));

      it('should return the extended datasets of Default project', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body[0].should.be.an.ExtendedDataset();
            body.map(({ createdAt, lastEntity, ...d }) => {
              createdAt.should.not.be.null();
              lastEntity.should.not.be.null();
              return d;
            }).should.eql([
              { name: 'people', projectId: 1, entities: 1, approvalRequired: false }
            ]);
          });
      }));

      it('should return the correct count and latest timestamp of entities', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await container.run(sql`UPDATE entities SET "createdAt" = '1999-1-1' WHERE TRUE`);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body[0].should.be.an.ExtendedDataset();
            body.map(({ createdAt, lastEntity, ...d }) => {
              lastEntity.should.not.startWith('1999');
              return d;
            }).should.eql([
              { name: 'people', projectId: 1, entities: 2, approvalRequired: false }
            ]);
          });
      }));

      it('should return the correct count for multiple dataset', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        // Create Datasets
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity
            .replace(/simpleEntity/g, 'simpleEntity2')
            .replace(/people/g, 'trees'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Make submissions
        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity2/submissions')
          .send(testData.instances.simpleEntity.one
            .replace(/simpleEntity/g, 'simpleEntity2')
            .replace(/123456789abc/g, '123456789000') // we have uniqueness contrainst on UUID for the whole table
            .replace(/people/g, 'trees'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        // Approve submissions
        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two')
          .send({ reviewState: 'approved' })
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity2/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.get('/v1/projects/1/datasets')
          .set('X-Extended-Metadata', 'true')
          .expect(200)
          .then(({ body }) => {
            body.map(({ createdAt, lastEntity, ...d }) => {
              createdAt.should.not.be.null();
              lastEntity.should.not.be.null();
              return d;
            }).reduce((a, v) => ({ ...a, [v.name]: v.entities }), {}).should.eql({
              people: 2, trees: 1
            });
          });
      }));
    });

    describe('projects/:id/datasets/:dataset.csv GET', () => {
      it('should reject if the user cannot access dataset', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/datasets/people/entities.csv')
                .expect(403))))));

      it('should let the user download the dataset (even if 0 entity rows)', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/datasets/people/entities.csv')
              .expect(200)
              .then(({ text }) => {
                text.should.equal('__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt\n');
              })))));

      it('should return only published properties', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity
            .replace(/simpleEntity/g, 'simpleEntity2')
            .replace(/first_name/, 'full_name'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(({ text }) => {
            text.should.equal('__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt\n');
          });

      }));

      it('should reject if dataset does not exist', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/datasets/nonexistent/entities.csv')
              .expect(404)))));

      it('should reject if dataset is not published', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/datasets/people/entities.csv')
              .expect(404)))));

      it('should return csv file with data', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/two')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(r => r.text);

        const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;

        result.match(isoRegex).should.have.length(2);

        const withOutTs = result.replace(isoRegex, '');
        withOutTs.should.be.eql(
          '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt\n' +
            '12345678-1234-4123-8234-123456789aaa,Jane (30),Jane,30,,5,Alice,0,\n' +
            '12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88,,5,Alice,0,\n'
        );

      }));

      it('should return csv file for dataset that have dot in its property name', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/age/g, 'the.age'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one.replace(/age/g, 'the.age'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(r => r.text);

        const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;

        result.match(isoRegex).should.have.length(1);

        const withOutTs = result.replace(isoRegex, '');
        withOutTs.should.be.eql(
          '__id,label,first_name,the.age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt\n' +
            '12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88,,5,Alice,0,\n'
        );

      }));

      it('should not return deleted entities', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111aaa',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111bbb',
            label: 'Robert Doe',
            data: { first_name: 'Robert', age: '88' }
          })
          .expect(200);

        await asAlice.delete('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111bbb');

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(r => r.text);

        result.should.not.match(/Robert Doe/);

      }));

      it('should return updated value correctly', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/people/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111aaa',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-111111111aaa?force=true')
          .send({
            data: { first_name: 'Robert', age: '' },
            label: 'Robert Doe (expired)'
          })
          .expect(200);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(r => r.text);

        const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g;

        result.match(isoRegex).should.have.length(2);

        const withOutTs = result.replace(isoRegex, '');
        withOutTs.should.be.eql(
          '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt\n' +
            '12345678-1234-4123-8234-111111111aaa,Robert Doe (expired),Robert,,,5,Alice,1,\n'
        );

      }));

      it('should return 304 content not changed if ETag matches', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200);

        const withOutTs = result.text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/g, '');
        withOutTs.should.be.eql(
          '__id,label,first_name,age,__createdAt,__creatorId,__creatorName,__updates,__updatedAt\n' +
          '12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88,,5,Alice,0,\n'
        );

        const etag = result.get('ETag');

        await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .set('If-None-Match', etag)
          .expect(304);
      }));

    });

    describe('projects/:id/datasets/:name GET', () => {

      it('should return the metadata of the dataset', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/age/g, 'the.age'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity
            .replace(/simpleEntity/, 'simpleEntity2')
            .replace(/age/g, 'address'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments
            .replace(/goodone.csv/, 'people.csv'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {

            const { createdAt, linkedForms, properties, ...ds } = body;

            ds.should.be.eql({
              name: 'people',
              projectId: 1,
              approvalRequired: false
            });

            createdAt.should.not.be.null();

            linkedForms.should.be.eql([{ name: 'withAttachments', xmlFormId: 'withAttachments' }]);

            properties.map(({ publishedAt, ...p }) => {
              publishedAt.should.be.isoDate();
              return p;
            }).should.be.eql([
              { name: 'first_name', odataName: 'first_name', forms: [
                { name: 'simpleEntity', xmlFormId: 'simpleEntity' },
                { name: 'simpleEntity2', xmlFormId: 'simpleEntity2' }
              ] },
              { name: 'the.age', odataName: 'the_age', forms: [ { name: 'simpleEntity', xmlFormId: 'simpleEntity' }, ] },
              { name: 'address', odataName: 'address', forms: [ { name: 'simpleEntity2', xmlFormId: 'simpleEntity2' }, ] }
            ]);

          });

      }));

      it('should not return duplicate linkedForms', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments
            .replace(/goodone.csv/, 'people.csv'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/withAttachments/draft')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish?version=2.0')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {

            const { linkedForms } = body;

            linkedForms.should.be.eql([{ name: 'withAttachments', xmlFormId: 'withAttachments' }]);
          });

      }));

      it('should return properties of a dataset in order', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            properties.map((p) => p.name)
              .should.be.eql([
                'b_q1',
                'd_q2',
                'a_q3',
                'c_q4'
              ]);
          });
      }));

      it('should return dataset properties from multiple forms in order', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            properties.map((p) => p.name)
              .should.be.eql([
                'b_q1',
                'd_q2',
                'a_q3',
                'c_q4',
                'f_q1',
                'e_q2'
              ]);
          });
      }));

      it('should return dataset properties from multiple forms including updated form with updated schema', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/multiPropertyEntity/draft')
          .send(testData.forms.multiPropertyEntity
            .replace('orx:version="1.0"', 'orx:version="2.0"')
            .replace('b_q1', 'g_q1'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/multiPropertyEntity/draft/publish').expect(200);

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            properties.map((p) => p.name)
              .should.be.eql([
                'b_q1',
                'd_q2',
                'a_q3',
                'c_q4',
                'f_q1',
                'e_q2',
                'g_q1'
              ]);
          });
      }));

      it('should return dataset properties when purged draft form shares some properties', testService(async (service, { Forms }) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.delete('/v1/projects/1/forms/multiPropertyEntity')
          .expect(200);

        await Forms.purge(true);

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            properties.map((p) => p.name)
              .should.be.eql([
                'f_q1',
                'e_q2',
                'a_q3',
                'c_q4'
              ]);
          });
      }));

      it('should return dataset properties when draft form (purged before second form publish) shares some properties', testService(async (service, { Forms }) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.delete('/v1/projects/1/forms/multiPropertyEntity')
          .expect(200);

        await Forms.purge(true);

        await asAlice.post('/v1/projects/1/forms/multiPropertyEntity2/draft/publish');

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            properties.map((p) => p.name)
              .should.be.eql([
                'f_q1',
                'e_q2',
                'a_q3',
                'c_q4'
              ]);
          });
      }));

      it.skip('should return ordered dataset properties including from deleted published form', testService(async (service, { Forms }) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.delete('/v1/projects/1/forms/multiPropertyEntity')
          .expect(200);

        await Forms.purge(true);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.multiPropertyEntity
            .replace('multiPropertyEntity', 'multiPropertyEntity2')
            .replace('b_q1', 'f_q1')
            .replace('d_q2', 'e_q2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/foo')
          .expect(200)
          .then(({ body }) => {
            const { properties } = body;
            // Properties are coming out in this other order:
            // [ 'a_q3', 'c_q4', 'b_q1', 'd_q2', 'f_q1', 'e_q2' ]
            // It's not terrible but would rather all the props of the first form
            // show up first.
            properties.map((p) => p.name)
              .should.be.eql([
                'b_q1',
                'd_q2',
                'a_q3',
                'c_q4',
                'f_q1',
                'e_q2'
              ]);
          });
      }));

      // bug # 833
      it('should not return null in properties.forms when creation form is updated', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish?version=v2.0')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {
            body.properties[0].name.should.be.eql('first_name');
            body.properties[0].forms.should.be.eql([
              {
                xmlFormId: 'simpleEntity',
                name: 'simpleEntity'
              }
            ]);

            body.properties[1].name.should.be.eql('age');
            body.properties[1].forms.should.be.eql([
              {
                xmlFormId: 'simpleEntity',
                name: 'simpleEntity'
              }
            ]);
          });
      }));


      // bug # 833
      it('should not return deleted form', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.delete('/v1/projects/1/forms/simpleEntity')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms?ignoreWarnings=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish?version=v2')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {
            body.properties[0].name.should.be.eql('first_name');
            body.properties[0].forms.should.be.eql([
              {
                xmlFormId: 'simpleEntity',
                name: 'simpleEntity'
              }
            ]);

            body.properties[1].name.should.be.eql('age');
            body.properties[1].forms.should.be.eql([
              {
                xmlFormId: 'simpleEntity',
                name: 'simpleEntity'
              }
            ]);
          });
      }));

    });
  });

  describe('linking form attachments to datasets', () => {
    describe('projects/:id/forms/:formId/draft/attachment/:name PATCH', () => {
      it('should reject unless user can form.update', testService((service) =>
        service.login(['alice', 'chelsea'], (asAlice, asChelsea) =>
          Promise.all([
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200),
            asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace('people', 'goodone'))
              .set('Content-Type', 'application/xml')
              .expect(200)
          ])
            .then(() => asChelsea.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(403)))));

      it('should reject if user can form.update but not entity.list', testService((service) =>
        service.login(['alice', 'chelsea'], (asAlice, asChelsea) =>
          Promise.all([
            asChelsea.get('/v1/users/current')
              .expect(200)
              .then(({ body }) => body.id),
            asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments)
              .set('Content-Type', 'application/xml')
              .expect(200),
            asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace('people', 'goodone'))
              .set('Content-Type', 'application/xml')
              .expect(200)
          ])
            .then(([chelseaId]) => asAlice.post(`/v1/projects/1/forms/withAttachments/assignments/manager/${chelseaId}`)
              .expect(200))
            .then(() => asChelsea.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(403)))));

      it('should link dataset to form and returns in manifest', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(200)
              .then(({ body }) => omit(['updatedAt'], body).should.be.eql({
                name: 'goodone.csv',
                type: 'file',
                exists: true,
                blobExists: false,
                datasetExists: true
              })))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish?version=newversion')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
              .expect(200)
              .then(({ body }) => {
                body[0].name.should.equal('goodone.csv');
                body[0].datasetExists.should.equal(true);
                body[0].updatedAt.should.be.a.recentIsoDate();
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text }) => {
                const domain = config.get('default.env.domain');
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
    <mediaFile>
      <filename>goodone.csv</filename>
      <hash>md5:0c0fb6b2ee7dbb235035f7f6fdcfe8fb</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withAttachments/attachments/goodone.csv</downloadUrl>
    </mediaFile>
  </manifest>`);
              })))));



      it('should override blob and link dataset', testService((service, { Forms, FormAttachments, Audits, Datasets }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => Promise.all([
              Forms.getByProjectAndXmlFormId(1, 'withAttachments', false, Form.DraftVersion).then(getOrNotFound),
              Datasets.get(1, 'goodone').then(getOrNotFound)
            ]))
            .then(([form, dataset]) => FormAttachments.getByFormDefIdAndName(form.draftDefId, 'goodone.csv').then(getOrNotFound)
              .then(attachment => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
                .send({ dataset: true })
                .expect(200)
                .then(() => Audits.getLatestByAction('form.attachment.update').then(getOrNotFound)
                  .then(({ details }) => {
                    const { formDefId, ...attachmentDetails } = details;
                    formDefId.should.not.be.null();
                    attachmentDetails.should.be.eql({
                      name: 'goodone.csv',
                      oldBlobId: attachment.blobId,
                      newBlobId: null,
                      oldDatasetId: null,
                      newDatasetId: dataset.id
                    });
                  })))
              .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
                .set('X-OpenRosa-Version', '1.0')
                .expect(200)
                .then(({ text }) => {
                  const domain = config.get('default.env.domain');
                  text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
    <mediaFile>
      <filename>goodone.csv</filename>
      <hash>md5:0c0fb6b2ee7dbb235035f7f6fdcfe8fb</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withAttachments/attachments/goodone.csv</downloadUrl>
    </mediaFile>
  </manifest>`);
                }))))));

      it('should allow an attachment to have a .CSV extension', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments.replace('goodone.csv', 'goodone.CSV'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace('people', 'goodone'))
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.CSV')
              .send({ dataset: true })
              .expect(200)
              .then(({ body }) => {
                body.should.be.a.FormAttachment();
                body.datasetExists.should.be.true();
              })))));

      it('should unlink dataset from the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: false })
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments')
              .expect(200)
              .then(({ body }) => {
                body[0].name.should.equal('goodone.csv');
                body[0].datasetExists.should.equal(false);
                body[0].updatedAt.should.be.a.recentIsoDate();
              }))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text }) => {
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
  </manifest>`);
              })))));

      it('should return error if dataset is not found', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(404)))));

      // Here withAttachment form has an audio file without extension
      // hence dataset name is matching but because file type is audio
      // it should return problem
      it('should throw problem if datasetId is being set for non-data type', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments.replace('goodtwo.mp3', 'goodtwo'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/g, 'goodtwo'))
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodtwo')
              .send({ dataset: true })
              .expect(400)
              .then(({ body }) => {
                body.message.should.be.equal('Dataset can only be linked to attachments with "Data File" type.');
              })))));

      it('should return error if dataset is not published', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity.replace(/people/g, 'goodone'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send({ dataset: true })
          .expect(404);

      }));

    });

    describe('projects/:id/forms/:formId/draft/attachment/:name DELETE', () => {
      it('should unlink dataset from the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(200))
            .then(() => asAlice.delete('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
              .set('X-OpenRosa-Version', '1.0')
              .expect(200)
              .then(({ text }) => {
                text.should.equal(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
  </manifest>`);
              })))));
    });

    describe('autolink dataset to attachments', () => {
      it('should set datasetId of attachment on form draft upload', testService((service, { Forms, FormAttachments }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() =>
                Forms.getByProjectAndXmlFormId(1, 'withAttachments')
                  .then(form => FormAttachments.getByFormDefIdAndName(form.value.def.id, 'people.csv')
                    .then(attachment => {
                      attachment.value.datasetId.should.not.be.null();
                    })))))));

      it('should not link dataset if previous version has blob', testService((service, { Forms, FormAttachments }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/people.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
              .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() =>
              Forms.getByProjectAndXmlFormId(1, 'withAttachments')
                .then(form => FormAttachments.getByFormDefIdAndName(form.value.def.id, 'people.csv')
                  .then(attachment => {
                    should(attachment.value.datasetId).be.null();
                    should(attachment.value.blobId).not.be.null();
                  }))))));

      it('should link dataset if previous version does not have blob or dataset linked', testService((service, { Forms, FormAttachments }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/people.csv')
              .send({ dataset: false })
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft')
              .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() =>
              Forms.getByProjectAndXmlFormId(1, 'withAttachments')
                .then(form => FormAttachments.getByFormDefIdAndName(form.value.def.id, 'people.csv')
                  .then(attachment => {
                    should(attachment.value.datasetId).not.be.null();
                    should(attachment.value.blobId).be.null();
                  }))))));

      // Verifying autolinking happens only for attachment with "file" type
      it('should not set datasetId of non-file type attachment', testService((service, { Forms, FormAttachments }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.withAttachments.replace(/goodtwo.mp3/g, 'people'))
              .set('Content-Type', 'application/xml')
              .expect(200)
              .then(() =>
                Forms.getByProjectAndXmlFormId(1, 'withAttachments')
                  .then(form => FormAttachments.getByFormDefIdAndName(form.value.def.id, 'people')
                    .then(attachment => {
                      should(attachment.value.datasetId).be.null();
                    })))))));
    });

    // these scenario will never happen by just using APIs, adding following tests for safety
    describe('check datasetId constraints', () => {
      it('should throw problem if blobId and datasetId are being set', testService((service, { Forms, FormAttachments, Datasets }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/, 'goodone')))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send('test,csv\n1,2')
              .set('Content-Type', 'text/csv')
              .expect(200))
            .then(() => Promise.all([
              Forms.getByProjectAndXmlFormId(1, 'withAttachments', false, Form.DraftVersion).then(getOrNotFound),
              Datasets.get(1, 'goodone').then(getOrNotFound)
            ]))
            .then(([form, dataset]) => FormAttachments.getByFormDefIdAndName(form.draftDefId, 'goodone.csv').then(getOrNotFound)
              .then((attachment) => FormAttachments.update(form, attachment, 1, dataset.id)
                .catch(error => {
                  error.constraint.should.be.equal('check_blobId_or_datasetId_is_null');
                }))))));

      it('should throw problem if datasetId is being set for non-data type', testService((service, { Forms, FormAttachments, Datasets }) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity))
            .then(() => Promise.all([
              Forms.getByProjectAndXmlFormId(1, 'withAttachments', false, Form.DraftVersion).then(getOrNotFound),
              Datasets.get(1, 'people').then(getOrNotFound)
            ]))
            .then(([form, dataset]) => FormAttachments.getByFormDefIdAndName(form.draftDefId, 'goodtwo.mp3').then(getOrNotFound)
              .then((attachment) => FormAttachments.update(form, attachment, null, dataset.id)
                .catch(error => {
                  error.constraint.should.be.equal('check_datasetId_is_null_for_non_file');
                }))))));
    });

    describe('projects/:id/forms/:formId/attachments/:name (entities dataset)', () => {

      const createBothForms = async (asAlice) => {
        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/people/g, 'goodone'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200);
      };

      it('should return entities csv', testService((service, container) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.withAttachments)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity.replace(/people/g, 'goodone'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
              .send(testData.instances.simpleEntity.one.replace(/people/g, 'goodone'))
              .set('Content-Type', 'application/xml')
              .expect(200))
            .then(() => exhaust(container))
            .then(() => asAlice.patch('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
              .send({ dataset: true })
              .expect(200))
            .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
              .expect(200))
            .then(() => asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
              .expect(200)
              .then(({ headers, text }) => {
                headers['content-disposition'].should.equal('attachment; filename="goodone.csv"; filename*=UTF-8\'\'goodone.csv');
                headers['content-type'].should.equal('text/csv; charset=utf-8');
                text.should.equal('name,label,first_name,age\n12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88\n');
              })))));

      it('should return entities csv for testing', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await createBothForms(asAlice);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one.replace(/people/g, 'goodone'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        const token = await asAlice.get('/v1/projects/1/forms/withAttachments/draft')
          .expect(200)
          .then(({ body }) => body.draftToken);

        await service.get(`/v1/test/${token}/projects/1/forms/withAttachments/draft/attachments/goodone.csv`)
          .expect(200)
          .then(({ text }) => { text.should.equal('name,label,first_name,age\n12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88\n'); });

      }));

      it('should return data for columns that contain valid special characters', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity
            .replace(/people/g, 'goodone')
            .replace(/age/g, 'the.age'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one
            .replace(/people/g, 'goodone')
            .replace(/age/g, 'the.age'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);


        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .expect(200)
          .then(({ text }) => {
            text.should.equal('name,label,first_name,the.age\n' +
          '12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88\n');
          });

      }));

      it('should not return deleted entities', testService(async (service) => {
        const asAlice = await service.login('alice');

        await createBothForms(asAlice);

        await asAlice.post('/v1/projects/1/datasets/goodone/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111aaa',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        await asAlice.post('/v1/projects/1/datasets/goodone/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111bbb',
            label: 'Robert Doe',
            data: { first_name: 'Robert', age: '88' }
          })
          .expect(200);

        await asAlice.delete('/v1/projects/1/datasets/goodone/entities/12345678-1234-4123-8234-111111111bbb');

        const result = await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
          .expect(200)
          .then(r => r.text);

        result.should.not.match(/Robert Doe/);

      }));

      it('should return updated value correctly', testService(async (service) => {
        const asAlice = await service.login('alice');

        await createBothForms(asAlice);

        await asAlice.post('/v1/projects/1/datasets/goodone/entities')
          .send({
            uuid: '12345678-1234-4123-8234-111111111aaa',
            label: 'Johnny Doe',
            data: { first_name: 'Johnny', age: '22' }
          })
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/goodone/entities/12345678-1234-4123-8234-111111111aaa?force=true')
          .send({
            data: { first_name: 'Robert', age: '' },
            label: 'Robert Doe (expired)'
          })
          .expect(200);

        const result = await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/goodone.csv')
          .expect(200)
          .then(r => r.text);

        result.should.be.eql(
          'name,label,first_name,age\n' +
          '12345678-1234-4123-8234-111111111aaa,Robert Doe (expired),Robert,\n'
        );

      }));

      it('should return md5 of last Entity timestamp in the manifest', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        const result = await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200);

        const etag = result.get('ETag');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/withAttachments/manifest')
          .set('X-OpenRosa-Version', '1.0')
          .expect(200)
          .then(({ text }) => {
            const domain = config.get('default.env.domain');
            text.should.be.eql(`<?xml version="1.0" encoding="UTF-8"?>
  <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
    <mediaFile>
      <filename>people.csv</filename>
      <hash>md5:${etag.replace(/"/g, '')}</hash>
      <downloadUrl>${domain}/v1/projects/1/forms/withAttachments/attachments/people.csv</downloadUrl>
    </mediaFile>
  </manifest>`);
          });

      }));

      it('should return 304 content not changed if ETag matches', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.withAttachments.replace(/goodone/g, 'people'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        const result = await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
          .expect(200);

        result.text.should.be.eql(
          'name,label,first_name,age\n' +
          '12345678-1234-4123-8234-123456789abc,Alice (88),Alice,88\n'
        );

        const etag = result.get('ETag');

        await asAlice.get('/v1/projects/1/forms/withAttachments/attachments/people.csv')
          .set('If-None-Match', etag)
          .expect(304);

      }));

    });
  });

  describe('dataset diffs', () => {
    describe('/projects/:id/forms/:formId/draft/dataset-diff GET', () => {

      it('should reject dataset-diff if the user cannot modify the form', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
                .expect(403))))));

      it('should reject if user can modify form but not list datasets on project', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/users/current')
                .expect(200)
                .then(({ body }) => body)))
            .then((chelsea) =>
              asAlice.post(`/v1/projects/1/forms/simpleEntity/assignments/manager/${chelsea.id}`)
                .expect(200))
            .then(() => service.login('chelsea', (asChelsea) =>
              asChelsea.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
                .expect(403))))));

      it('should return all properties of dataset', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
              .expect(200)
              .then(({ body }) => {
                body.should.be.eql([
                  {
                    name: 'people',
                    isNew: true,
                    properties: [
                      { name: 'age', isNew: true, inForm: true },
                      { name: 'first_name', isNew: true, inForm: true }
                    ]
                  }
                ]);
              })));
      }));

      it('should return all properties with isNew to be false', testService(async (service) => {
        // Upload a form and then create a new draft version
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity.replace(/simpleEntity/, 'simpleEntity2'))
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity2/draft/dataset-diff')
                .expect(200)
                .then(({ body }) => {
                  body.should.be.eql([
                    {
                      name: 'people',
                      isNew: false,
                      properties: [
                        { name: 'age', isNew: false, inForm: true },
                        { name: 'first_name', isNew: false, inForm: true }
                      ]
                    }
                  ]);
                }))));
      }));

      it('should return all properties with appropriate value of isNew', testService(async (service) => {
        // Upload a form and then create a new draft version
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity
                .replace(/simpleEntity/, 'simpleEntity2')
                .replace(/saveto="first_name"/, 'saveto="lastName"'))
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity2/draft/dataset-diff')
                .expect(200)
                .then(({ body }) => {
                  body.should.be.eql([{
                    name: 'people',
                    isNew: false,
                    properties: [
                      { name: 'age', isNew: false, inForm: true },
                      { name: 'first_name', isNew: false, inForm: false },
                      { name: 'lastName', isNew: true, inForm: true }
                    ]
                  }]);
                }))));
      }));

      it('should return dataset name only if no property mapping is defined', testService(async (service) => {
        // Upload a form and then create a new draft version
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace(/entities:saveto="\w+"/g, ''))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
              .expect(200)
              .then(({ body }) => {
                body.should.be.eql([{
                  name: 'people',
                  isNew: true,
                  properties: []
                }]);
              })));
      }));

      it('should return empty array if there is no dataset defined', testService(async (service) => {
        // Upload a form and then create a new draft version
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simple.replace(/simple/, 'simple2'))
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simple2/draft/dataset-diff')
              .expect(200)
              .then(({ body }) => {
                body.should.be.eql([]);
              })));
      }));

      it('should return only properties of the dataset of the requested project', testService(async (service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects')
              .set('Content-Type', 'application/json')
              .send({ name: 'Second Project' })
              .expect(200)
              .then(({ body }) =>
                asAlice.post(`/v1/projects/${body.id}/forms`)
                  .send(testData.forms.simpleEntity.replace(/age/g, 'email'))
                  .set('Content-Type', 'application/xml')
                  .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
                .expect(200)
                .then(({ body }) =>
                  body.should.be.eql([
                    {
                      name: 'people',
                      isNew: true,
                      properties: [
                        { name: 'age', isNew: true, inForm: true },
                        { name: 'first_name', isNew: true, inForm: true }
                      ]
                    }])))))));

      it('should return inForm false for removed property', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity)
          .expect(200);

        // Let's create a draft without age property in dataset
        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity
            .replace('entities:saveto="age"', ''))
          .expect(200);

        // Verify age.inForm should be false
        await asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            body.should.be.eql([{
              name: 'people',
              isNew: false,
              properties: [
                { name: 'age', isNew: false, inForm: false },
                { name: 'first_name', isNew: false, inForm: true }
              ]
            }]);
          });
      }));

      it('should return empty array if managed encryption is enabled', testService(async (service) => {
        // Upload a form and then create a new draft version
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/key')
          .send({ passphrase: 'supersecret' })
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            body.should.be.eql([]);
          });
      }));

      it('should return empty array if form is encrypted', testService(async (service) => {
        // Upload a form and then create a new draft version
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity.replace('</model>', '<submission base64RsaPublicKey="abc"/></model>'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/draft/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            body.should.be.eql([]);
          });
      }));
    });

    describe('/projects/:id/forms/:formId/dataset-diff GET', () => {
      it('should return all properties of dataset', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/dataset-diff')
              .expect(200)
              .then(({ body }) => {
                body.should.be.eql([
                  {
                    name: 'people',
                    properties: [
                      { name: 'age', inForm: true },
                      { name: 'first_name', inForm: true }
                    ]
                  }
                ]);
              })));
      }));

      it('should return all properties with appropriate value of inForm', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms?publish=true')
              .send(testData.forms.simpleEntity
                .replace(/simpleEntity/, 'simpleEntity2')
                .replace(/saveto="first_name"/, 'saveto="last_name"'))
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity2/dataset-diff')
                .expect(200)
                .then(({ body }) => {
                  body.should.be.eql([{
                    name: 'people',
                    properties: [
                      { name: 'age', inForm: true },
                      { name: 'first_name', inForm: false },
                      { name: 'last_name', inForm: true }
                    ]
                  }]);
                }))));
      }));

      it('should not return unpublished properties', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity
                .replace(/simpleEntity/, 'simpleEntity2')
                .replace(/saveto="first_name"/, 'saveto="last_name"'))
              .expect(200)
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/dataset-diff')
                .expect(200)
                .then(({ body }) => {
                  body.should.be.eql([{
                    name: 'people',
                    properties: [
                      { name: 'age', inForm: true },
                      { name: 'first_name', inForm: true }
                    ]
                  }]);
                }))));
      }));

      it('should return dataset name only if there is no properties', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/entities:saveto[^/]+/g, ''))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/forms/simpleEntity/dataset-diff')
          .expect(200)
          .then(({ body }) => {
            body.should.be.eql([{
              name: 'people',
              properties: []
            }]);
          });

      }));

      it('should let the user download even if there are no properties', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/entities:saveto[^/]+/g, ''))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities.csv')
          .expect(200)
          .then(({ text }) => {
            text.should.equal('__id,label,__createdAt,__creatorId,__creatorName,__updates,__updatedAt\n');
          });
      }));

    });
  });

  describe('parsing datasets on form upload', () => {
    describe('parsing datasets at /projects/:id/forms POST', () => {
      it('should return a Problem if the entity xml has the wrong version', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace('2022.1.0', 'bad-version'))
            .set('Content-Type', 'text/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.25);
              body.details.reason.should.equal('Entities specification version [bad-version] is not supported.');
            }))));

      it('should return a Problem if the entity xml is invalid (e.g. missing dataset name)', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace('dataset="people"', ''))
            .set('Content-Type', 'text/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.25);
              body.details.reason.should.equal('Dataset name is missing.');
            }))));

      it('should return a Problem if the savetos reference invalid properties', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace('first_name', 'name'))
            .set('Content-Type', 'text/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.25);
              body.details.reason.should.equal('Invalid Dataset property.');
            }))));

      it('should return a Problem if the savetos reference invalid properties (extra whitespace)', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace('first_name', '  first_name  '))
            .set('Content-Type', 'text/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.equal(400.25);
              body.details.reason.should.equal('Invalid Dataset property.');
            }))));

      it('should return the created form upon success', testService((service) =>
        service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Form();
              body.xmlFormId.should.equal('simpleEntity');

              return asAlice.get('/v1/projects/1/forms/simpleEntity/draft')
                .set('X-Extended-Metadata', 'true')
                .expect(200)
                .then(({ body: getBody }) => {
                  getBody.should.be.a.Form();
                  getBody.entityRelated.should.equal(true);
                });
            }))));

      it('should accept entity form and save dataset with no binds', testService((service) => {
        const xml = `<h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa" xmlns:entities="http://www.opendatakit.org/xforms">
        <h:head>
          <h:title>nobinds</h:title>
          <model entities:entities-version='2022.1.0'>
            <instance>
              <data id="nobinds">
                <name/>
                <age/>
                <meta>
                  <entity dataset="something" id="" create="1">
                    <label/>
                  </entity>
                </meta>
              </data>
            </instance>
          </model>
        </h:head>
      </h:html>`;
        return service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(xml)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(({ body }) => {
              body.should.be.a.Form();
              body.xmlFormId.should.equal('nobinds');
            }));
      }));

      it('should not let multiple fields to be mapped to a single property', testService(async (service) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity.replace(/first_name/g, 'age'))
            .set('Content-Type', 'application/xml')
            .expect(400)
            .then(({ body }) => {
              body.code.should.be.eql(400.25);
              body.message.should.be.eql('The entity definition within the form is invalid. Multiple Form Fields cannot be saved to a single Dataset Property.');
            }));
      }));

      it('should publish dataset when any dataset creating form is published', testService(async (service) => {
        const alice = await service.login('alice');

        await alice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await alice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity.replace(/simpleEntity/g, 'simpleEntity2'))
          .set('Content-Type', 'application/xml')
          .expect(200);

        await alice.get('/v1/projects/1/datasets')
          .expect(200)
          .then(({ body }) => {
            body[0].name.should.be.eql('people');
          });

        await alice.get('/v1/projects/1/datasets/people')
          .expect(200)
          .then(({ body }) => {
            body.name.should.be.eql('people');
          });

      }));

      describe('updating datasets through new form drafts', () => {
        it('should update a dataset with a new draft and be able to upload multiple drafts', testService(async (service) => {
          const asAlice = await service.login('alice');

          // Upload a form and then create a new draft version
          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
              .expect(200)
              .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
                .send(testData.forms.simpleEntity)
                .set('Content-Type', 'application/xml')
                .expect(200))
              .then(() => asAlice.get('/v1/projects/1/forms/simpleEntity/draft')
                .set('X-Extended-Metadata', 'true')
                .expect(200)
                .then(({ body }) => {
                  body.entityRelated.should.equal(true);
                })));

          await asAlice.get('/v1/projects/1/datasets')
            .expect(200)
            .then(({ body }) => {
              body[0].name.should.be.eql('people');
            });

          await asAlice.get('/v1/projects/1/datasets/people')
            .expect(200)
            .then(({ body }) => {
              body.name.should.be.eql('people');
              body.properties.length.should.be.eql(2);
            });
        }));

        it('should return a Problem if updated form has invalid dataset properties', testService(async (service) => {
          const asAlice = await service.login('alice');
          await asAlice.post('/v1/projects/1/forms?publish=true')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'application/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
              .send(testData.forms.simpleEntity.replace('first_name', 'name'))
              .set('Content-Type', 'application/xml')
              .expect(400)
              .then(({ body }) => {
                body.code.should.equal(400.25);
                body.details.reason.should.equal('Invalid Dataset property.');
              }));
        }));
      });
    });

    describe('dataset audit logging at /projects/:id/forms POST', () => {
      it('should log dataset creation in audit log', testService(async (service, { Audits }) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'text/xml')
            .expect(200));

        const audit = await Audits.getLatestByAction('dataset.create').then((o) => o.get());
        audit.details.fields.should.eql([['/name', 'first_name'], ['/age', 'age']]);
      }));

      it('should log dataset modification in audit log', testService(async (service, { Audits }) => {
        await service.login('alice', (asAlice) =>
          asAlice.post('/v1/projects/1/forms')
            .send(testData.forms.simpleEntity)
            .set('Content-Type', 'text/xml')
            .expect(200)
            .then(() => asAlice.post('/v1/projects/1/forms')
              .send(testData.forms.simpleEntity
                .replace('simpleEntity', 'simpleEntity2')
                .replace('first_name', 'color_name'))
              .set('Content-Type', 'text/xml')
              .expect(200)));

        const audit = await Audits.getLatestByAction('dataset.create').then((o) => o.get());
        audit.details.fields.should.eql([['/name', 'first_name'], ['/age', 'age']]);

        const audit2 = await Audits.getLatestByAction('dataset.update').then((o) => o.get());
        audit2.details.fields.should.eql([['/name', 'color_name'], ['/age', 'age']]);

        audit.acteeId.should.equal(audit2.acteeId);
      }));

      it('should log dataset publishing in audit log', testService(async (service, { Audits }) => {

        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'text/xml')
          .expect(200);

        await Audits.getLatestByAction('dataset.update.publish')
          .then(o => o.get())
          .then(audit => audit.details.should.eql({ properties: ['first_name', 'age'] }));

        await asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.simpleEntity
            .replace('simpleEntity', 'simpleEntity2')
            .replace('first_name', 'color_name'))
          .set('Content-Type', 'text/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity2/draft/publish')
          .expect(200);

        await Audits.getLatestByAction('dataset.update.publish')
          .then(o => o.get())
          .then(audit => audit.details.should.eql({ properties: ['age', 'color_name', 'first_name'] }));

      }));

    });

    describe('dataset property interaction with intermediate form schemas and purging uneeded drafts', () => {
      it('should clean up form fields and dataset properties of unneeded drafts', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity)
          .expect(200);

        // ignoring warning about removing a field
        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft?ignoreWarnings=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity.replace('orx:version="1.0"', 'orx:version="draft1"').replace(/first_name/g, 'nickname'))
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.simpleEntity.replace('orx:version="1.0"', 'orx:version="draft"'))
          .expect(200);

        // there are expected to be
        // 2 defs of this form (published and new draft)
        // 6 form fields of original form (and new form): 3 entity related fields and 3 question fields
        // ideally only 4 ds property fields, but 2 from deleted def are still there
        await Promise.all([
          container.oneFirst(sql`select count(*) from form_defs as fd join forms as f on fd."formId" = f.id where f."xmlFormId"='simpleEntity'`),
          container.oneFirst(sql`select count(*) from form_fields as fs join forms as f on fs."formId" = f.id where f."xmlFormId"='simpleEntity'`),
          container.oneFirst(sql`select count(*) from ds_property_fields`),
        ])
          .then((counts) => counts.should.eql([ 2, 6, 6 ]));

      }));
    });
  });

  describe('form schemas and dataset properties', () => {
    it('should populate entity properties based on correct form schema', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      // Submission to old (and only) version of form should have only age filled in
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Upload a new version of the form with saveto added to hometown
      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity
          .replace('<bind nodeset="/data/hometown" type="string"/>', '<bind nodeset="/data/hometown" type="string" entities:saveto="hometown"/>'))
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish?version=2.0')
        .expect(200);

      // Submission to old version of form should make entity with age filled in
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.two)
        .set('Content-Type', 'application/xml')
        .expect(200);

      // Submission to new version of form should make entity with hometown filled in
      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.three.replace('version="1.0"', 'version="2.0"'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Upload a new version of the form with saveto removed from age
      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity
          .replace('<bind nodeset="/data/age" type="int" entities:saveto="age"/>', '<bind nodeset="/data/age" type="int"/>')
          .replace('<bind nodeset="/data/hometown" type="string"/>', '<bind nodeset="/data/hometown" type="string" entities:saveto="hometown"/>'))
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/publish?version=3.0')
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.four.replace('version="1.0"', 'version="3.0"'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await exhaust(container);

      // Submission 1 - should just have name and age
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.should.have.property('data').which.is.eql({ age: '88', first_name: 'Alice' });
        });

      // Submission 2 - should also just have name and age
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789aaa')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.should.have.property('data').which.is.eql({ age: '30', first_name: 'Jane' });
        });

      // Submission 3 - should have name, age and hometown filled in
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789bbb')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.should.have.property('data').which.is.eql({ age: '40', hometown: 'Toronto', first_name: 'John' });
        });

      // Submission 4 - should have name and hometown filled in, NO age
      await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789ccc')
        .expect(200)
        .then(({ body: person }) => {
          person.currentVersion.should.have.property('data').which.is.eql({ first_name: 'Robert', hometown: 'Seattle' });
        });
    }));
  });

  describe('dataset and entities should have isolated lifecycle', () => {
    it('should allow a form that has created an entity to be purged', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
        .send(testData.instances.simpleEntity.one)
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity.replace('simpleEntity', 'simpleEntityDup'))
        .expect(200);

      await asAlice.post('/v1/projects/1/forms/simpleEntityDup/submissions')
        .send(testData.instances.simpleEntity.one
          .replace('simpleEntity', 'simpleEntityDup')
          .replace(/Alice/g, 'Jane')
          .replace('12345678-1234-4123-8234-123456789abc', '12345678-1234-4123-8234-123456789def'))
        .set('Content-Type', 'application/xml')
        .expect(200);

      await asAlice.patch('/v1/projects/1/forms/simpleEntityDup/submissions/one')
        .send({ reviewState: 'approved' })
        .expect(200);

      await exhaust(container);

      await asAlice.delete('/v1/projects/1/forms/simpleEntity')
        .expect(200);

      await container.Forms.purge(true);

      await container.all(sql`SELECT * FROM entity_defs
        JOIN entity_def_sources ON entity_defs."sourceId" = entity_def_sources.id`)
        .then(eDefs => {
          // Ensures that we are only clearing submissionDefId of entities whose submission/form is purged
          should(eDefs.find(d => d.data.first_name === 'Alice').submissionDefId).be.null();
          should(eDefs.find(d => d.data.first_name === 'Jane').submissionDefId).not.be.null();
        });
    }));

    it('should return published dataset even if corresponding form is deleted', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/simpleEntity')
        .expect(200);

      await container.Forms.purge(true);

      await asAlice.get('/v1/projects/1/datasets')
        .expect(200)
        .then(({ body }) => {
          body.length.should.equal(1);
        });
    }));

    it('should keep dataset and its property status intact even if corresponding form is deleted', testService(async (service, container) => {
      const asAlice = await service.login('alice');

      await asAlice.post('/v1/projects/1/forms?publish=true')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity)
        .expect(200);

      await asAlice.delete('/v1/projects/1/forms/simpleEntity')
        .expect(200);

      await container.Forms.purge(true);

      // let's create another form that defines same dataset with a different property
      await asAlice.post('/v1/projects/1/forms')
        .set('Content-Type', 'application/xml')
        .send(testData.forms.simpleEntity
          .replace(/first_name/g, 'last_name')
          .replace(/simpleEntity/g, 'simpleEntityDup'))
        .expect(200);

      await asAlice.get('/v1/projects/1/forms/simpleEntityDup/draft/dataset-diff')
        .expect(200)
        .then(({ body }) => {
          body.should.be.eql([{
            name: 'people',
            isNew: false,
            properties: [
              { name: 'age', isNew: false, inForm: true },
              { name: 'first_name', isNew: false, inForm: false },
              { name: 'last_name', isNew: true, inForm: true }
            ]
          }]);
        });

    }));

  });

  describe('configurable approval requirements', () => {
    describe('PATCH /datasets/:name', () => {

      it('should return notfound if the dataset does not exist', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.patch('/v1/projects/1/datasets/nonexistent')
          .expect(404);
      }));

      it('should reject if the user cannot read', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        const asChelsea = await service.login('chelsea');

        await asChelsea.patch('/v1/projects/1/datasets/people')
          .expect(403);
      }));

      it('should allow setting approval requirements', testService(async (service) => {

        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        const dataset = await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        dataset.body.approvalRequired.should.equal(true);

      }));

      it('should return bad request if value of convert query param is invalid', testService(async (service) => {

        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people?convert=dummy')
          .send({ approvalRequired: true })
          .expect(400)
          .then(({ body }) => {
            body.code.should.be.eql(400.8);
          });

      }));

      it('should return warning if there are pending submissions', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/forms/simpleEntity/submissions/one')
          .send({ reviewState: 'approved' })
          .expect(200);

        await exhaust(container);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: false })
          .expect(400)
          .then(({ body }) => {
            body.code.should.be.eql(400.29);
            body.details.count.should.be.eql(1);
          });
      }));

      it('should update dataset when pending submissions are draft or deleted', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .expect(200);

        // Draft submission
        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.delete('/v1/projects/1/forms/simpleEntity')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: false })
          .expect(200);
      }));

      it('should update the flag without automatic conversions', testService(async (service) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people?convert=false')
          .send({ approvalRequired: false })
          .expect(200)
          .then(({ body }) => body.approvalRequired.should.be.false());

        // there are no entities
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.should.be.eql([]));

      }));

      it('should automatically convert pending submissions', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // There are no entities
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.length.should.be.eql(0));

        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200)
          .then(({ body }) => body.approvalRequired.should.be.false());

        await exhaust(container);

        // Entities are created now
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.length.should.be.eql(2));

        await asAlice.get('/v1/projects/1/datasets/people/entities/12345678-1234-4123-8234-123456789abc/audits')
          .expect(200)
          .then(({ body: logs }) => {
            logs[0].should.be.an.Audit();
            logs[0].action.should.be.eql('entity.create');
            logs[0].actor.displayName.should.be.eql('Alice');

            logs[0].details.submission.should.be.a.Submission();
            logs[0].details.submission.xmlFormId.should.be.eql('simpleEntity');
            logs[0].details.submission.currentVersion.instanceName.should.be.eql('one');
            logs[0].details.submission.currentVersion.submitter.displayName.should.be.eql('Alice');
          });



      }));

      it('should not convert deleted submissions', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // There are no entities because approval is required
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.length.should.be.eql(0));

        // Delete the form which means submissions are to be deleted
        // Currently we don't have a way to delete a Submission
        await asAlice.delete('/v1/projects/1/forms/simpleEntity')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200)
          .then(({ body }) => body.approvalRequired.should.be.false());

        await exhaust(container);

        // Still no Entities
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.length.should.be.eql(0));
      }));

      it('should not convert draft submissions', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft')
          .expect(200);

        // Draft submission
        await asAlice.post('/v1/projects/1/forms/simpleEntity/draft/submissions')
          .send(testData.instances.simpleEntity.one)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200);

        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.should.be.eql([]));
      }));

      it('should log error if there is a problem in a submission while auto converting', testService(async (service, container) => {
        const asAlice = await service.login('alice');

        await asAlice.post('/v1/projects/1/forms?publish=true')
          .send(testData.forms.simpleEntity)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.patch('/v1/projects/1/datasets/people')
          .send({ approvalRequired: true })
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.one.replace('<entities:label>Alice (88)</entities:label>', '')) //removing label
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.two)
          .set('Content-Type', 'application/xml')
          .expect(200);

        await asAlice.post('/v1/projects/1/forms/simpleEntity/submissions')
          .send(testData.instances.simpleEntity.three.replace('create="1"', 'create="0"')) // don't create entity
          .set('Content-Type', 'application/xml')
          .expect(200);

        await exhaust(container);

        // There are no entities
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => body.length.should.be.eql(0));

        await asAlice.patch('/v1/projects/1/datasets/people?convert=true')
          .send({ approvalRequired: false })
          .expect(200)
          .then(({ body }) => body.approvalRequired.should.be.false());

        await exhaust(container);

        // One Entity is created
        await asAlice.get('/v1/projects/1/datasets/people/entities')
          .expect(200)
          .then(({ body }) => {
            body.length.should.be.eql(1);
          });

        const entityErrors = await container.Audits.get(new QueryOptions({ args: { action: 'entity.create.error' } }));

        entityErrors.length.should.be.eql(1);
        entityErrors[0].details.errorMessage.should.match(/Required parameter label missing/);

      }));
    });
  });
});
