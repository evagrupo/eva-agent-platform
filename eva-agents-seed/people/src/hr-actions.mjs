import {
  adjustLeaveBalance,
  approveLeave,
  cancelLeave,
  cancelReferral,
  createCandidate,
  createEmployee,
  createEmployeeFromUser,
  createLeave,
  getCandidate,
  getEmployee,
  getLeave,
  getPayrollConfig,
  getPayrollRun,
  hireCandidate,
  calculatePayrollRun,
  createExpense,
  createExpenseTemplate,
  createPayrollRun,
  deleteExpense,
  deleteExpenseTemplate,
  deletePayrollRun,
  generateExpenses,
  markPayrollRunPaid,
  markReferralPaid,
  moveCandidateStage,
  listExpenseTemplates,
  listExpenses,
  listPayrollRuns,
  rejectCandidate,
  rejectLeave,
  reinstateReferral,
  searchCandidates,
  searchDirectoryUsers,
  searchEmployees,
  searchLeaves,
  updateExpense,
  updateExpenseTemplate,
  updatePayrollConfig,
  updatePayrollEntry,
  approvePayrollRun,
  searchReferrals,
  updateCandidate,
  updateEmployee,
  updateLeave,
} from './hr-adapter.mjs';

function rawInput() {
  const value = process.argv[3];
  if (value === undefined) throw new Error('Provide a JSON input object as the third argument.');
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function objectInput() {
  const value = rawInput();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The third argument must be a JSON object.');
  }
  return value;
}

function idFrom(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.id !== undefined) return value.id;
  return value;
}

function bodyWithoutId(value, omittedKeys = ['id']) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The third argument must be a JSON object containing id.');
  const body = { ...value };
  for (const key of omittedKeys) delete body[key];
  return body;
}

const action = process.argv[2];
let result;

try {
  switch (action) {
    case 'get-employee':
      result = await getEmployee(idFrom(rawInput()));
      break;
    case 'search-employees':
      result = await searchEmployees(objectInput());
      break;
    case 'create-employee':
      result = await createEmployee(objectInput());
      break;
    case 'create-employee-from-user':
      result = await createEmployeeFromUser(objectInput());
      break;
    case 'update-employee': {
      const input = objectInput();
      result = await updateEmployee(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'get-candidate':
      result = await getCandidate(idFrom(rawInput()));
      break;
    case 'search-candidates':
      result = await searchCandidates(objectInput());
      break;
    case 'create-candidate':
      result = await createCandidate(objectInput());
      break;
    case 'update-candidate': {
      const input = objectInput();
      result = await updateCandidate(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'move-candidate-stage': {
      const input = objectInput();
      result = await moveCandidateStage(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'reject-candidate': {
      const input = objectInput();
      result = await rejectCandidate(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'hire-candidate': {
      const input = objectInput();
      result = await hireCandidate(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'get-leave':
      result = await getLeave(idFrom(rawInput()));
      break;
    case 'search-leaves':
      result = await searchLeaves(objectInput());
      break;
    case 'create-leave':
      result = await createLeave(objectInput());
      break;
    case 'update-leave': {
      const input = objectInput();
      result = await updateLeave(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'approve-leave': {
      const input = objectInput();
      result = await approveLeave(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'reject-leave': {
      const input = objectInput();
      result = await rejectLeave(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'cancel-leave': {
      const input = objectInput();
      result = await cancelLeave(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'adjust-leave-balance':
      result = await adjustLeaveBalance(objectInput());
      break;
    case 'search-referrals':
      result = await searchReferrals(objectInput());
      break;
    case 'mark-referral-paid': {
      const input = objectInput();
      if (!input.half) throw new Error('half must be first or second.');
      const { id, half, ...body } = input;
      result = await markReferralPaid(id, half, body);
      break;
    }
    case 'cancel-referral': {
      const input = objectInput();
      result = await cancelReferral(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'reinstate-referral': {
      const input = objectInput();
      result = await reinstateReferral(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'list-payroll-runs':
      result = await listPayrollRuns(objectInput());
      break;
    case 'get-payroll-run':
      result = await getPayrollRun(idFrom(rawInput()));
      break;
    case 'create-payroll-run':
      result = await createPayrollRun(objectInput());
      break;
    case 'calculate-payroll-run': {
      const input = objectInput();
      result = await calculatePayrollRun(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'update-payroll-entry': {
      const input = objectInput();
      if (input.employeeId === undefined) throw new Error('employeeId is required.');
      result = await updatePayrollEntry(idFrom(input), input.employeeId, bodyWithoutId(input, ['id', 'employeeId']));
      break;
    }
    case 'approve-payroll-run': {
      const input = objectInput();
      result = await approvePayrollRun(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'mark-paid-payroll-run': {
      const input = objectInput();
      result = await markPayrollRunPaid(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'delete-payroll-run': {
      const input = objectInput();
      result = await deletePayrollRun(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'get-payroll-config':
      result = await getPayrollConfig();
      break;
    case 'update-payroll-config':
      result = await updatePayrollConfig(objectInput());
      break;
    case 'list-expenses':
      result = await listExpenses(objectInput());
      break;
    case 'create-expense':
      result = await createExpense(objectInput());
      break;
    case 'update-expense': {
      const input = objectInput();
      result = await updateExpense(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'delete-expense': {
      const input = objectInput();
      result = await deleteExpense(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'generate-expenses':
      result = await generateExpenses(objectInput());
      break;
    case 'list-expense-templates':
      result = await listExpenseTemplates(objectInput());
      break;
    case 'create-expense-template':
      result = await createExpenseTemplate(objectInput());
      break;
    case 'update-expense-template': {
      const input = objectInput();
      result = await updateExpenseTemplate(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'delete-expense-template': {
      const input = objectInput();
      result = await deleteExpenseTemplate(idFrom(input), bodyWithoutId(input));
      break;
    }
    case 'search-directory-users':
      result = await searchDirectoryUsers(objectInput());
      break;
    default:
      throw new Error('Unknown HR action. Use a documented HR action name.');
  }
  console.log(JSON.stringify(result));
} catch (error) {
  const message = error instanceof Error ? error.message : 'HR action failed.';
  console.error(message);
  process.exitCode = 1;
}
