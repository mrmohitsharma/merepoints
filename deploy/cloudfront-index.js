// CloudFront Function (viewer request) for the web dashboard on S3.
// /merchant/counter  -> /merchant/counter/index.html   (static export uses folder/index.html)
function handler(event) {
  var r = event.request;
  if (r.uri.endsWith('/')) r.uri += 'index.html';
  else if (!r.uri.split('/').pop().includes('.')) r.uri += '/index.html';
  return r;
}
