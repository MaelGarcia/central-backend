// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { map, mergeLeft } = require('ramda');
const { Actee, Actor, Audit, Dataset, Form, Project, Submission } = require('../frames');
const { extender, equals, page, QueryOptions, unjoiner } = require('../../util/db');
const Option = require('../../util/option');
const { construct } = require('../../util/util');


const log = (actor, action, actee, details) => ({ run, context }) => {
  const actorId = Option.of(actor).map((x) => x.id).orNull();
  const acteeId = Option.of(actee).map((x) => x.acteeId).orNull();
  const processed = Audit.actionableEvents.includes(action) ? null : sql`clock_timestamp()`;
  const notes = (context == null) ? null :
    context.headers['x-action-notes'] == null ? null :
    decodeURIComponent(context.headers['x-action-notes']); // eslint-disable-line indent

  return run(sql`
insert into audits ("actorId", action, "acteeId", details, notes, "loggedAt", processed, failures)
values (${actorId}, ${action}, ${acteeId}, ${(details == null) ? null : JSON.stringify(details)}, ${notes}, clock_timestamp(), ${processed}, 0)`);
};


// we explicitly use where..in with a known lookup for performance.
// TODO: some sort of central table for all these things, not here.
const actionCondition = (action) => {
  if (action === 'nonverbose')
    // The backup action was logged by a backup script that has been removed.
    // Even though the script has been removed, the audit log entries it logged
    // have not, so we should continue to exclude those.
    return sql`action not in ('entity.create', 'entity.create.error', 'entity.update.version', 'entity.delete', 'submission.create', 'submission.update', 'submission.update.version', 'submission.attachment.update', 'backup', 'analytics')`;
  else if (action === 'user')
    return sql`action in ('user.create', 'user.update', 'user.delete', 'user.assignment.create', 'user.assignment.delete', 'user.session.create')`;
  else if (action === 'field_key')
    return sql`action in ('field_key.create', 'field_key.assignment.create', 'field_key.assignment.delete', 'field_key.session.end', 'field_key.delete')`;
  else if (action === 'public_link')
    return sql`action in ('public_link.create', 'public_link.assignment.create', 'public_link.assignment.delete', 'public_link.session.end', 'public_link.delete')`;
  else if (action === 'project')
    return sql`action in ('project.create', 'project.update', 'project.delete')`;
  else if (action === 'form')
    return sql`action in ('form.create', 'form.update', 'form.delete', 'form.restore', 'form.purge', 'form.attachment.update', 'form.submission.export', 'form.update.draft.set', 'form.update.draft.delete', 'form.update.publish')`;
  else if (action === 'submission')
    return sql`action in ('submission.create', 'submission.update', 'submission.update.version', 'submission.attachment.update')`;
  else if (action === 'dataset')
    return sql`action in ('dataset.create', 'dataset.update', 'dataset.update.publish')`;
  else if (action === 'entity')
    return sql`action in ('entity.create', 'entity.create.error', 'entity.update.version', 'entity.delete')`;

  return sql`action=${action}`;
};


// used entirely by tests only:
const getLatestByAction = (action) => ({ maybeOne }) =>
  maybeOne(sql`select * from audits where action=${action} order by "loggedAt" desc limit 1`)
    .then(map(construct(Audit)));


// filter condition fragment used below in _get.
const auditFilterer = (options) => {
  const result = [];
  options.ifArg('start', (start) => result.push(sql`"loggedAt" >= ${start}`));
  options.ifArg('end', (end) => result.push(sql`"loggedAt" <= ${end}`));
  options.ifArg('action', (action) => result.push(actionCondition(action)));
  return (result.length === 0) ? sql`true` : sql.join(result, sql` and `);
};

const _get = extender(Audit)(Option.of(Actor), Option.of(Actor.alias('actee_actor', 'acteeActor')), Option.of(Form), Option.of(Form.Def), Option.of(Project), Option.of(Dataset), Option.of(Actee))((fields, extend, options) => sql`
select ${fields} from audits
  ${extend|| sql`
    left outer join actors on actors.id=audits."actorId"
    left outer join projects on projects."acteeId"=audits."acteeId"
    left outer join actors as actee_actor on actee_actor."acteeId"=audits."acteeId"
    left outer join forms on forms."acteeId"=audits."acteeId"
    left outer join form_defs on form_defs.id=forms."currentDefId"
    left outer join datasets on datasets."acteeId"=audits."acteeId"
    left outer join actees on actees.id=audits."acteeId"`}
  where ${equals(options.condition)} and ${auditFilterer(options)}
  order by "loggedAt" desc, audits.id desc
  ${page(options)}`);
const get = (options = QueryOptions.none) => ({ all }) =>
  _get(all, options).then((rows) => {
    // we need to actually put the formdef inside the form.
    if (rows.length === 0) return rows;
    if (rows[0].aux.form === undefined) return rows; // not extended

    // TODO: better if we don't have to loop over all this data twice.
    return rows.map((row) => {
      const form = row.aux.form.map((f) => f.withAux('def', row.aux.def));
      const actees = [ row.aux.acteeActor, form, row.aux.project, row.aux.dataset, row.aux.actee ];
      return new Audit(row, { actor: row.aux.actor, actee: Option.firstDefined(actees) });
    });
  });

const _getBySubmissionId = extender(Audit)(Option.of(Actor))((fields, extend, options, submissionId) => sql`
select ${fields} from audits
  ${extend|| sql`left outer join actors on actors.id=audits."actorId"`}
  where (details->'submissionId'::text)=${submissionId}
  order by "loggedAt" desc, audits.id desc
  ${page(options)}`);
const getBySubmissionId = (submissionId, options) => ({ all }) =>
  _getBySubmissionId(all, options, submissionId);



const _getByEntityId = (fields, options, entityId) => sql`
SELECT ${fields} FROM audits
  LEFT JOIN actors ON actors.id=audits."actorId"

  LEFT JOIN entity_defs ON (audits.details->'entityDefId')::INTEGER = entity_defs.id
  LEFT JOIN entity_def_sources on entity_def_sources.id = entity_defs."sourceId"

  LEFT JOIN audits triggering_event ON entity_def_sources."auditId" = triggering_event.id
  LEFT JOIN actors triggering_event_actor ON triggering_event_actor.id = triggering_event."actorId"

  -- if triggering event has a submissionId defined, look up creation event for that submission
  -- it has info about the submission and creator we want to show even if the submission is deleted
  LEFT JOIN audits submission_create_event ON (triggering_event.details->'submissionId')::INTEGER = (submission_create_event.details->'submissionId')::INTEGER AND submission_create_event.action = 'submission.create'
  LEFT JOIN actors submission_create_event_actor ON submission_create_event_actor.id = submission_create_event."actorId"

  -- if source submissionDefId is defined:
  LEFT JOIN (
    (
      SELECT submissions.*, submission_defs."userAgent" FROM submissions
      JOIN submission_defs ON submissions.id = submission_defs."submissionId" AND root AND submissions."deletedAt" IS NULL
    ) submissions
    JOIN forms
      ON forms.id = submissions."formId" AND forms."deletedAt" IS NULL
        AND submissions."deletedAt" IS NULL
    JOIN submission_defs AS current_submission_def
      ON submissions.id = current_submission_def."submissionId" AND current
    JOIN submission_defs AS linked_submission_def
      ON submissions.id = linked_submission_def."submissionId"
  ) on linked_submission_def.id = entity_def_sources."submissionDefId"

  LEFT JOIN actors submission_actor ON submission_actor.id = submissions."submitterId"
  LEFT JOIN actors current_submission_actor on current_submission_actor.id=current_submission_def."submitterId"

  -- if some other kind of target object defined, add subquery here
  -- ...

  WHERE (audits.details->>'entityId')::INTEGER = ${entityId}
  ORDER BY audits."loggedAt" DESC, audits.id DESC
  ${page(options)}`;

const getByEntityId = (entityId, options) => ({ all }) => {

  const _unjoiner = unjoiner(
    Audit, Actor,
    Option.of(Audit.alias('triggering_event', 'triggeringEvent')), Option.of(Actor.alias('triggering_event_actor', 'triggeringEventActor')),
    Option.of(Audit.alias('submission_create_event', 'submissionCreateEvent')), Option.of(Actor.alias('submission_create_event_actor', 'submissionCreateEventActor')),
    Option.of(Submission), Option.of(Submission.Def.alias('current_submission_def', 'currentVersion')),
    Option.of(Actor.alias('current_submission_actor', 'currentSubmissionActor')),
    Option.of(Actor.alias('submission_actor', 'submissionActor')),
    Option.of(Form)
  );

  return all(_getByEntityId(_unjoiner.fields, options, entityId))
    .then(map(_unjoiner))
    .then(map(audit => {

      const sourceEvent = audit.aux.triggeringEvent
        .map(a => a.withAux('actor', audit.aux.triggeringEventActor.orNull()))
        .map(a => a.forApi());

      const submissionCreate = audit.aux.submissionCreateEvent
        .map(a => a.withAux('actor', audit.aux.submissionCreateEventActor.orNull()))
        .map(a => a.forApi());

      const submission = audit.aux.submission
        .map(s => s.withAux('submitter', audit.aux.submissionActor.orNull()))
        .map(s => s.withAux('currentVersion', audit.aux.currentVersion.map(v => v.withAux('submitter', audit.aux.currentSubmissionActor.orNull()))))
        .map(s => s.forApi())
        .map(s => mergeLeft(s, { xmlFormId: audit.aux.form.map(f => f.xmlFormId).orNull() }));

      const details = mergeLeft(audit.details, {
        sourceEvent: sourceEvent.orElse(undefined),
        submissionCreate: submissionCreate.orElse(undefined),
        submission: submission.orElse(undefined)
      });

      return new Audit({ ...audit, details }, { actor: audit.aux.actor });
    }));
};


module.exports = {
  log, getLatestByAction, get,
  getBySubmissionId, getByEntityId
};

