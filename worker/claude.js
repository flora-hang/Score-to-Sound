/* Calls the Claude Messages API with one page image and streams the reply back. */
import { Buffer } from "node:buffer";

/**
 * Read one page. `onText(delta)` is called as Claude writes.
 * Resolves {text, inputTokens, outputTokens, truncated}; rejects with {code, message, retryable}.
 */
export async function readPageWithClaude(env, {model, image, mediaType, prompt, signal, onText, onActivity}){
  const res = await fetch((env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages", {
    method: "POST", signal,
    headers: {"x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    body: JSON.stringify({
      // Current models think before answering, and that thinking counts toward max_tokens,
      // so leave plenty of room and keep the thinking level moderate (EFFORT in wrangler.toml).
      model, max_tokens: parseInt(env.MAX_OUTPUT_TOKENS || "48000", 10), stream: true,
      ...(env.EFFORT ? {output_config: {effort: env.EFFORT}} : {}),
      messages: [{role: "user", content: [
        {type: "image", source: {type: "base64", media_type: mediaType, data: Buffer.from(image).toString("base64")}},
        {type: "text", text: prompt},
      ]}],
    }),
  });
  if(!res.ok){
    const body = await res.text().catch(() => "");
    console.error("anthropic", res.status, body.slice(0, 500));
    if(res.status === 429 || res.status === 529 || res.status >= 500) throw {code: "upstream_busy", message: "The AI service is busy. Please try again in a minute.", retryable: true};
    if(res.status === 400 && /image/i.test(body)) throw {code: "image_rejected", message: "This page image couldn't be used. Try a clearer scan or photo.", retryable: false};
    throw {code: "upstream_error", message: "Reading this page failed. Please try again.", retryable: true};
  }
  let text = "", inputTokens = 0, outputTokens = 0, stop = null, buf = "";
  const reader = res.body.getReader(), dec = new TextDecoder();
  for(;;){
    const {value, done} = await reader.read();
    if(done) break;
    buf += dec.decode(value, {stream: true});
    let i;
    while((i = buf.indexOf("\n\n")) >= 0){
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
      if(!data) continue;
      let ev; try{ ev = JSON.parse(data); }catch(_){ continue; }
      if(ev.type === "message_start") inputTokens = ev.message?.usage?.input_tokens || 0;
      else if(ev.type === "content_block_delta" && ev.delta?.type === "text_delta"){ text += ev.delta.text; onText && onText(ev.delta.text); }
      else if(onActivity) onActivity();              // thinking, pings: still working
      else if(ev.type === "message_delta"){ outputTokens = ev.usage?.output_tokens ?? outputTokens; stop = ev.delta?.stop_reason ?? stop; }
      else if(ev.type === "error") throw {code: ev.error?.type === "overloaded_error" ? "upstream_busy" : "upstream_error", message: "The AI service had a problem. Please try again.", retryable: true};
    }
  }
  return {text, inputTokens, outputTokens, stop, truncated: stop === "max_tokens"};
}
