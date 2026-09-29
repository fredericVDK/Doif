const {randomUUID}=require('node:crypto');
const {AuthError}=require('../auth/errors');

const FALLBACK_MESSAGE='Pigeon Crumbs is temporarily unavailable. Please try again.';

function requestReference() {
  return randomUUID();
}

function errorStatus(error) {
  return error instanceof AuthError?error.status:503;
}

function publicApiError(error,{requestId,presentPigeon=()=>({})}={}) {
  const known=error instanceof AuthError;
  const status=errorStatus(error);
  const body={
    error:known?error.message:FALLBACK_MESSAGE,
    code:known?error.code:'API_UNAVAILABLE',
    requestId,
    retryable:status===429||status>=500
  };
  if(known&&error.retryAfter) body.retryAfter=error.retryAfter;
  if(known&&error.pigeon) Object.assign(body,{pigeon:error.pigeon},presentPigeon(error.pigeon));
  return {status,body};
}

function safeCode(value) {
  return typeof value==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(value)?value:undefined;
}

function technicalError(error,{requestId,method,path}={}) {
  const known=error instanceof AuthError;
  return {
    requestId,
    method,
    path,
    status:errorStatus(error),
    code:known?error.code:'UNEXPECTED',
    ...(safeCode(error?.providerCode)?{providerCode:error.providerCode}:{}),
    ...(!known&&safeCode(error?.name)?{type:error.name}:{})
  };
}

module.exports={FALLBACK_MESSAGE,requestReference,errorStatus,publicApiError,technicalError};
