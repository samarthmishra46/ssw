// Local development only. Some home routers never answer IPv6 (AAAA) DNS queries, so every
// lookup stalls 15+ s before falling back, and calls to I AM time out. This makes Node look up
// IPv4 addresses only. Use: NODE_OPTIONS="--require ./scripts/ipv4-dns.cjs" npm run dev
const dns = require("node:dns");
const lookup = dns.lookup;
dns.lookup = function (host, opts, cb) {
  if (typeof opts === "function") {
    cb = opts;
    opts = {};
  }
  if (typeof opts === "number") opts = { family: opts };
  return lookup.call(dns, host, { ...opts, family: 4 }, cb);
};
