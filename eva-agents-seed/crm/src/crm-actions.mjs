import { createLead, findUsers, getLead, rollbackLead } from './crm-adapter.mjs';

function jsonInput() {
  const value = process.argv[3];
  if (!value) throw new Error('Provide a JSON input object as the third argument.');
  return JSON.parse(value);
}

const action = process.argv[2];
let result;

switch (action) {
  case 'get-lead':
    result = await getLead(process.argv[3]);
    break;
  case 'find-users':
    result = await findUsers(jsonInput());
    break;
  case 'create-lead':
    result = await createLead(jsonInput());
    break;
  case 'rollback-lead':
    result = await rollbackLead(jsonInput());
    break;
  default:
    throw new Error('Use find-users, get-lead, create-lead, or rollback-lead.');
}

console.log(JSON.stringify(result));
