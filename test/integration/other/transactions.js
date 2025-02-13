const appRoot = require('app-root-path');
const { sql } = require('slonik');
// eslint-disable-next-line import/no-dynamic-require
const { testContainerFullTrx } = require(appRoot + '/test/integration/setup');
// eslint-disable-next-line import/no-dynamic-require
const { exhaust } = require(appRoot + '/lib/worker/worker');
// eslint-disable-next-line import/no-dynamic-require
const { Frame } = require(appRoot + '/lib/model/frame');
// eslint-disable-next-line import/no-dynamic-require
const { injector } = require(appRoot + '/lib/model/container');
// eslint-disable-next-line import/no-dynamic-require
const { endpointBase } = require(appRoot + '/lib/http/endpoint');
// eslint-disable-next-line import/no-dynamic-require
const { noop } = require(appRoot + '/lib/util/util');

describe('transaction integration', () => {
  it('should run all operations within the correct transaction context', () => {
    let queryRun = false;

    // do this in a block with really explicit names to isolate these var refs,
    // just to be completely sure.
    const getContainer = () => {
      const Capybaras = {
        create: () => ({ db }) => {
          db.isTransacting.should.equal(true);
          queryRun = true;
          return Promise.resolve(true);
        }
      };

      return injector({ db: {
        isTransacting: false,
        transaction(cb) { return Promise.resolve(cb({ isTransacting: true })); }
      } }, { Capybaras });
    };

    return endpointBase({ resultWriter: noop })(getContainer())(({ Capybaras }) =>
      Capybaras.create(new Frame({ id: 42 }))
    )({ method: 'POST' }) // eslint-disable-line function-paren-newline
      .then(() => { queryRun.should.equal(true); });
  });
});

// resolves in ms ms
const sometime = (ms) => new Promise((done) => setTimeout(done, ms));

describe('enketo worker transaction', () => {
  it('should not allow a write conflict @slow', testContainerFullTrx(async (container) => {
    const { Audits, Forms, oneFirst } = container;

    const simple = (await Forms.getByProjectAndXmlFormId(1, 'simple')).get();
    await Audits.log(null, 'form.update.publish', simple);

    let flush;
    global.enketo.wait = (f) => { flush = f; };
    const workerTicket = exhaust(container);
    // eslint-disable-next-line no-await-in-loop
    while (flush == null) await sometime(50);

    Forms.update(simple, { state: 'closed' });

    // now we wait to see if we have deadlocked, which we want.
    await sometime(400);
    (await Forms.getByProjectAndXmlFormId(1, 'simple')).get()
      .state.should.equal('open');

    // now finally resolve the locks.
    flush();
    await workerTicket;
    await sometime(100); // TODO: oh NO why is this necessary now?

    (await oneFirst(sql`select state from forms where "projectId"=1 and "xmlFormId"='simple'`))
      .should.equal('closed');
  }));
});

