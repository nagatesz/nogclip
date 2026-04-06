const bases = [
  "https://cobalt.clxxped.lol",
  "https://cobalt.meowing.de",
  "https://cobalt.cjs.nz"
];
const prefixes = ["", "/api", "/api/json"];
const apis = ["api.", ""];

async function check() {
  for (const b of bases) {
    const urlObj = new URL(b);
    for (const prefix of prefixes) {
        for (const sub of apis) {
            const host = sub ? sub + urlObj.hostname : urlObj.hostname;
            const targetUrl = `https://${host}${prefix}`;
            try {
                const res = await fetch(targetUrl, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
                body: JSON.stringify({ url: 'https://youtube.com/watch?v=jNQXAC9IVRw' }),
                signal: AbortSignal.timeout(3000)
                });
                const text = await res.text();
                console.log(`[${res.status}] ${targetUrl} -> ${text.substring(0, 50)}`);
            } catch(e) { /* console.log(`[ERR] ${targetUrl} -> ${e.message}`); */ }
        }
    }
  }
}
check();
