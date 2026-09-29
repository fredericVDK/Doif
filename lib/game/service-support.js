const {AuthError}=require('../auth/errors');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value==='string'&&UUID.test(value);
}
function requestIdInput(body,code,message) {
  if(!isUuid(body?.requestId)) throw new AuthError(400,code,message);
  return body.requestId;
}
function storageError(error,code,message) {
  const failure=new AuthError(503,code,message);
  failure.providerCode=error?.code;
  return failure;
}
function cooldownError(data,code,message,fallback=10) {
  const failure=new AuthError(429,code,message);
  failure.retryAfter=Math.max(1,Math.ceil(Number(data?.retryAfter)||fallback));
  return failure;
}

module.exports={isUuid,requestIdInput,storageError,cooldownError};
