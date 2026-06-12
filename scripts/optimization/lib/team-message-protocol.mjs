import fs from 'node:fs';
import path from 'node:path';
import { uniqueNowId } from './ids.mjs';

export const TEAM_MESSAGE_PROTOCOL_VERSION = '1.0.0';
export const TEAM_ROLES = Object.freeze([
  'team-lead',
  'quality-engineer',
  'rd-engineer',
  'process-engineer'
]);

export function createTeamMessage({
  role,
  from = role,
  to = [],
  stage,
  purpose,
  summary,
  inputs = [],
  outputs = [],
  risks = [],
  nextAction = '',
  artifactRefs = [],
  requestedActions = [],
  requiresResponse = false,
  replyToMessageId = null,
  personaSignal = '',
  payload = {}
}) {
  return {
    protocol_version: TEAM_MESSAGE_PROTOCOL_VERSION,
    message_id: `MSG-${uniqueNowId()}`,
    role,
    from,
    to: Array.isArray(to) ? to : [to],
    stage,
    purpose,
    summary,
    inputs,
    outputs,
    risks,
    next_action: nextAction,
    artifact_refs: artifactRefs,
    requested_actions: requestedActions,
    requires_response: Boolean(requiresResponse),
    reply_to_message_id: replyToMessageId,
    persona_signal: personaSignal,
    payload,
    created_at: new Date().toISOString()
  };
}

export function validateTeamMessage(message) {
  const errors = [];
  if (!message || typeof message !== 'object') return ['message_not_object'];
  if (message.protocol_version !== TEAM_MESSAGE_PROTOCOL_VERSION) errors.push('invalid_protocol_version');
  if (!TEAM_ROLES.includes(message.role)) errors.push(`invalid_role:${message.role}`);
  for (const key of ['message_id', 'stage', 'purpose', 'summary', 'next_action', 'created_at']) {
    if (typeof message[key] !== 'string' || message[key].length === 0) errors.push(`missing_string:${key}`);
  }
  for (const key of ['to', 'inputs', 'outputs', 'risks', 'artifact_refs', 'requested_actions']) {
    if (!Array.isArray(message[key])) errors.push(`missing_array:${key}`);
  }
  if (typeof message.requires_response !== 'boolean') errors.push('missing_boolean:requires_response');
  if (message.reply_to_message_id !== null && message.reply_to_message_id !== undefined && typeof message.reply_to_message_id !== 'string') {
    errors.push('invalid_string_or_null:reply_to_message_id');
  }
  if (!message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) {
    errors.push('missing_object:payload');
  }
  return errors;
}

export function assertTeamMessage(message) {
  const errors = validateTeamMessage(message);
  if (errors.length > 0) {
    throw new Error(`team_message_invalid:${errors.join(',')}`);
  }
  return message;
}

export function writeTeamProtocolMessage(teamDir, role, messageName, message) {
  assertTeamMessage(message);
  const boxType = role === 'team-lead' ? 'outbox' : 'inbox';
  const boxDir = path.join(teamDir, boxType, role);
  fs.mkdirSync(boxDir, { recursive: true });
  const filePath = path.join(boxDir, `${messageName}.json`);
  const messageWithName = {
    ...message,
    message_name: messageName
  };
  fs.writeFileSync(filePath, JSON.stringify(messageWithName, null, 2) + '\n');
  const busPath = path.join(teamDir, 'team_messages.jsonl');
  fs.mkdirSync(path.dirname(busPath), { recursive: true });
  fs.appendFileSync(busPath, JSON.stringify({
    kind: 'protocol_message',
    box_type: boxType,
    file_path: path.relative(teamDir, filePath),
    ...messageWithName
  }) + '\n');
  return filePath;
}

export function readTeamProtocolMessage(teamDir, role, messageName) {
  const boxType = role === 'team-lead' ? 'outbox' : 'inbox';
  const filePath = path.join(teamDir, boxType, role, `${messageName}.json`);
  if (!fs.existsSync(filePath)) return null;
  const message = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return assertTeamMessage(message);
}

export function summarizeProtocolMessage(message) {
  if (!message) return null;
  return {
    protocol_version: message.protocol_version,
    message_id: message.message_id,
    role: message.role,
    from: message.from,
    to: message.to,
    stage: message.stage,
    purpose: message.purpose,
    summary: message.summary,
    next_action: message.next_action,
    requested_actions: message.requested_actions,
    requires_response: message.requires_response,
    reply_to_message_id: message.reply_to_message_id || null
  };
}
