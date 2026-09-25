import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export function secretVariants(values) {
  return [...new Set(values.filter(Boolean).flatMap((value) => [value, encodeURIComponent(value), Buffer.from(value).toString('base64'), JSON.stringify(value).slice(1, -1)]))].sort((a, b) => b.length - a.length);
}

// Hold only a suffix that can still become a secret. A fixed tail is unnecessary
// and would delay ordinary short output and interactive-looking progress lines.
export class SecretMask extends Transform {
  constructor(values) {
    super(); this.secrets = secretVariants(values); this.pending = ''; this.decoder = new StringDecoder('utf8');
  }
  drain(final) {
    let at = 0; let output = '';
    while (at < this.pending.length) {
      const tail = this.pending.slice(at);
      if (!final && this.secrets.some((secret) => secret.length > tail.length && secret.startsWith(tail))) break;
      const match = this.secrets.find((secret) => tail.startsWith(secret));
      if (match) { output += '[redacted]'; at += match.length; }
      else { output += this.pending[at]; at++; }
    }
    this.pending = this.pending.slice(at);
    if (output) this.push(output);
  }
  _transform(chunk, encoding, callback) {
    this.pending += this.decoder.write(chunk); this.drain(false); callback();
  }
  _flush(callback) {
    this.pending += this.decoder.end(); this.drain(true); callback();
  }
}
