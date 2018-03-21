const { isBlank } = require('../util/util');
const { isTrue } = require('../util/http');
const Problem = require('../util/problem');
const Option = require('../util/option');


// Strips a /v# prefix off the request path and exposes on the request object
// under the apiVersion property.
const versionParser = (request, response, next) => {
  // this code will all break when we hit version 10 a century from now.
  const match = /^\/v(\d)\//.exec(request.url);
  if (match == null) return next(Problem.user.missingApiVersion());
  request.apiVersion = Number(match[1]);
  if (request.apiVersion !== 1) return next(Problem.user.unexpectedApiVersion({ got: match[1] }));
  request.url = request.url.slice(3);
  next();
};

// Used as pre-middleware, and injects the appropriate session information given the
// appropriate credentials. If the given credentials don't match a session, aborts
// with a 401. If no credentials are given, injects an empty session.
// TODO: probably a better home for this.
const sessionParser = ({ Session, Auth }) => (request, response, next) => {
  const authHeader = request.get('Authorization');
  if (!isBlank(authHeader) && authHeader.startsWith('Bearer ')) {
    if ((request.auth != null) && (request.auth.session.isDefined())) return next(Problem.user.authenticationFailed());

    Session.getByBearerToken(authHeader.slice(7)).point()
      .then((session) => {
        if (!session.isDefined()) return next(Problem.user.authenticationFailed());

        request.auth = new Auth({ session });
        next();
      });
  } else {
    request.auth = new Auth({ session: Option.none() });
    next();
  }
};

// Like sessionParser, but rather than parse OAuth2-style Bearer tokens from the
// header, picks up field keys from the url. Splices in /after/ the versionParser;
// does not expect or understand the version prefix.
//
// If authentication is already provided via Bearer token, we reject with 401.
//
// In addition to rejecting with 401 if the token is invalid, we also reject if
// the token does not belong to a field key, as only field keys may be used in
// this manner. (TODO: we should not explain in-situ for security reasons, but we
// should explain /somewhere/.)
const fieldKeyParser = ({ Session, Auth }) => (request, response, next) => {
  const match = /^\/key\/([a-z0-9!$]{64})\//i.exec(request.url);
  if (match == null) return next();
  if ((request.auth != null) && (request.auth.session.isDefined())) return next(Problem.user.authenticationFailed());

  Session.getByBearerToken(match[1]).point().then((session) => {
    if (!session.isDefined()) return next(Problem.user.authenticationFailed());
    if (session.get().actor.type !== 'field_key') return next(Problem.user.authenticationFailed());

    request.auth = new Auth({ session });
    request.url = request.url.slice('/key/'.length + match[1].length);
    next();
  });
};

// simply determines if we have been fed a true-ish value for X-Extended-Metadata.
// decorates onto request at request.extended.
const headerOptionsParser = (request, response, next) => {
  const extendedMeta = request.get('X-Extended-Metadata');
  if (isTrue(extendedMeta)) request.extended = true;
  next();
};


module.exports = { versionParser, sessionParser, fieldKeyParser, headerOptionsParser };
