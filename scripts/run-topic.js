const http = require('http');

const topic = process.argv[2] || "Mixture of Experts Scaling in Large Language Models";
console.log(`\n======================================================`);
console.log(`STARTING RESEARCH RUN ON TOPIC: "${topic}"`);
console.log(`======================================================\n`);

const startTime = Date.now();
const postData = JSON.stringify({ topic });

const req = http.request(
  {
    hostname: 'localhost',
    port: 3000,
    path: '/api/research',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  },
  (res) => {
    let buffer = '';
    let eventCount = 0;
    let runResult = null;
    const correctionEvents = [];

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // keep last incomplete chunk

      for (const block of lines) {
        const line = block.trim();
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6);
        if (dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          eventCount++;

          if (parsed.type === 'run_complete') {
            runResult = parsed.payload;
            console.log(`\n🎉 RUN COMPLETE payload received!`);
            continue;
          }

          // Track pipeline events
          const { agent, status, result_summary, tool_call, verdict, iteration, reason, claimId } = parsed;

          if (agent === 'writer' && iteration > 1) {
            correctionEvents.push(`[Writer Iteration ${iteration}]: ${result_summary || tool_call}`);
            console.log(`  🔄 [CORRECTION LOOP - Writer Revise] Iteration ${iteration}`);
          }

          if (agent === 'verifier') {
            if (status === 'result') {
              console.log(`  🔍 [Verifier Result - Iter ${iteration || 1}] Claim ${claimId} -> ${verdict?.toUpperCase()}: ${reason?.slice(0, 70)}`);
              if (verdict === 'unsupported' || verdict === 'weak') {
                correctionEvents.push(`[Verifier Iter ${iteration}]: ${claimId} failed: ${reason}`);
              }
            } else if (status === 'done') {
              console.log(`  📋 [Verifier Summary - Iter ${iteration || 1}]: ${result_summary}`);
            }
          } else if (status === 'started') {
            console.log(`▶ Agent [${agent}] started`);
          } else if (status === 'done' && agent !== 'verifier') {
            console.log(`✔ Agent [${agent}] completed: ${result_summary?.slice(0, 90) || ''}`);
          }
        } catch (e) {
          // ignore parse errors for partial chunks
        }
      }
    });

    res.on('end', () => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n======================================================`);
      console.log(`RUN FINISHED in ${elapsed}s (Total SSE Events: ${eventCount})`);
      console.log(`======================================================\n`);

      if (runResult) {
        const { runId, draft, verificationResults, publishResult } = runResult;
        console.log(`Run ID: ${runId}`);
        console.log(`Markdown Path: ${publishResult?.markdownPath}`);
        console.log(`Total Verification Results: ${verificationResults?.length || 0}`);

        const supported = verificationResults?.filter((r) => r.verdict === 'supported').length || 0;
        const weak = verificationResults?.filter((r) => r.verdict === 'weak').length || 0;
        const unsupported = verificationResults?.filter((r) => r.verdict === 'unsupported').length || 0;

        console.log(`  Supported:   ${supported}`);
        console.log(`  Weak:        ${weak}`);
        console.log(`  Unsupported: ${unsupported}`);
        const pct = verificationResults?.length ? Math.round((supported / verificationResults.length) * 100) : 0;
        console.log(`  Verified %:  ${pct}%`);
        console.log(`  Target Met:  ${verificationResults?.length >= 10 && pct >= 70 ? 'YES ✅' : 'NO ❌'}`);

        if (correctionEvents.length > 0) {
          console.log(`\nCorrection loop events logged:`);
          correctionEvents.forEach((e) => console.log(`  ${e}`));
        } else {
          console.log(`\nNo correction loop triggered (all claims passed on initial check or single round).`);
        }
      } else {
        console.log(`⚠️ No run_complete payload received (check server logs).`);
      }
    });
  }
);

req.on('error', (err) => {
  console.error('Request failed:', err.message);
});

req.write(postData);
req.end();
