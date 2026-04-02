import React, { useEffect, useRef, useState } from 'react';
import type { ClosedWonOpp, ForecastOpp, Quota } from '../../shared/types';
import { toCloseQuarter } from '../../shared/utils';

// ── Helpers ────────────────────────────────────────────────────

function fmtK(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

function countUniqueOpps(list: ForecastOpp[]): number {
  return new Set(list.map((o) => o.crm_opportunity_id)).size;
}

function buildContext(opps: ForecastOpp[], closedWon: ClosedWonOpp[], quotas: Quota[]): string {
  const arrOf = (o: ForecastOpp) => o.ais_arr ?? o.product_arr_usd;
  const currentQuarter = toCloseQuarter(new Date().toISOString().split('T')[0]);

  function getQuarterlyTarget(q: Quota): number | null {
    const match = currentQuarter.match(/Q(\d)/);
    if (!match) return null;
    const n = parseInt(match[1]);
    if (n === 1) return q.q1_target || null;
    if (n === 2) return q.q2_target || null;
    if (n === 3) return q.q3_target || null;
    if (n === 4) return q.q4_target || null;
    return null;
  }

  // Current quarter CW
  const cwThisQuarter = closedWon.filter((o) => toCloseQuarter(o.close_date) === currentQuarter);
  const totalCW = cwThisQuarter.reduce((s, o) => s + (o.edited_bookings ?? o.bookings), 0);
  const totalTarget = quotas.reduce((s, q) => s + (getQuarterlyTarget(q) ?? 0), 0);

  // Pipeline (all open opps)
  const totalPipeline  = opps.reduce((s, o) => s + arrOf(o), 0);
  const aisCommit      = opps.filter((o) => o.ais_forecast === 'Commit').reduce((s, o) => s + arrOf(o), 0);
  const aisMostLikely  = opps.filter((o) => o.ais_forecast === 'Most Likely').reduce((s, o) => s + arrOf(o), 0);
  const aisBestCase    = opps.filter((o) => o.ais_forecast === 'Best Case').reduce((s, o) => s + arrOf(o), 0);
  const aisRemaining   = opps.filter((o) => o.ais_forecast === 'Remaining Pipe').reduce((s, o) => s + arrOf(o), 0);

  // Leaderboard
  const allAiAes = [...new Set([
    ...opps.map((o) => o.ai_ae),
    ...cwThisQuarter.map((o) => o.ai_ae),
    ...quotas.map((q) => q.ai_ae),
  ].filter(Boolean))].sort();

  // Top deals in pipe grouped by opp
  const pipeMap: Record<string, { account_name: string; ai_ae: string; stage_name: string; vp_forecast: string; ais_forecast: string | null; products: string[]; arr: number }> = {};
  opps.forEach((o) => {
    if (!pipeMap[o.crm_opportunity_id]) {
      pipeMap[o.crm_opportunity_id] = { account_name: o.account_name, ai_ae: o.ai_ae, stage_name: o.stage_name, vp_forecast: o.vp_deal_forecast, ais_forecast: o.ais_forecast, products: [], arr: 0 };
    }
    pipeMap[o.crm_opportunity_id].products.push(o.product);
    pipeMap[o.crm_opportunity_id].arr += arrOf(o);
  });
  const topPipe = Object.values(pipeMap).sort((a, b) => b.arr - a.arr).slice(0, 20);

  // Top closed deals this quarter
  const cwMap: Record<string, { account_name: string; ai_ae: string; products: string[]; bookings: number }> = {};
  cwThisQuarter.forEach((o) => {
    if (!cwMap[o.crm_opportunity_id]) cwMap[o.crm_opportunity_id] = { account_name: o.account_name, ai_ae: o.ai_ae, products: [], bookings: 0 };
    cwMap[o.crm_opportunity_id].products.push(o.product);
    cwMap[o.crm_opportunity_id].bookings += (o.edited_bookings ?? o.bookings);
  });
  const topCW = Object.values(cwMap).sort((a, b) => b.bookings - a.bookings).slice(0, 10);

  let ctx = `PIPELINE DATA — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
Current fiscal quarter: ${currentQuarter}

=== QUOTA & ATTAINMENT (${currentQuarter}) ===
Team Target: ${totalTarget > 0 ? fmtK(totalTarget) : 'Not set'}
Closed Won: ${fmtK(totalCW)}
Attainment: ${totalTarget > 0 ? `${Math.round((totalCW / totalTarget) * 100)}%` : 'N/A'}

=== PIPELINE SUMMARY (all open opps) ===
Total Pipeline: ${fmtK(totalPipeline)} (${countUniqueOpps(opps)} opps)
AIS Commit: ${fmtK(aisCommit)}
AIS Most Likely: ${fmtK(aisMostLikely)}
AIS Best Case: ${fmtK(aisBestCase)}
Remaining/Unforecast: ${fmtK(aisRemaining)}
Deal Backed (CW + Commit + ML): ${fmtK(totalCW + aisCommit + aisMostLikely)}

=== TEAM LEADERBOARD (${currentQuarter}) ===
`;
  allAiAes.forEach((ae) => {
    const aeOpps   = opps.filter((o) => o.ai_ae === ae);
    const aeCW     = cwThisQuarter.filter((o) => o.ai_ae === ae);
    const quotaObj = quotas.find((q) => q.ai_ae === ae);
    const target   = quotaObj ? getQuarterlyTarget(quotaObj) : null;
    const cwTotal  = aeCW.reduce((s, o) => s + (o.edited_bookings ?? o.bookings), 0);
    const commit   = aeOpps.filter((o) => o.ais_forecast === 'Commit').reduce((s, o) => s + arrOf(o), 0);
    const ml       = aeOpps.filter((o) => o.ais_forecast === 'Most Likely').reduce((s, o) => s + arrOf(o), 0);
    const pipeline = aeOpps.reduce((s, o) => s + arrOf(o), 0);
    const pct      = target ? `${Math.round((cwTotal / target) * 100)}%` : 'no target';
    ctx += `${ae}: CW ${fmtK(cwTotal)}${target ? ` / Target ${fmtK(target)} (${pct})` : ''} | Commit ${fmtK(commit)} | ML ${fmtK(ml)} | Pipeline ${fmtK(pipeline)}\n`;
  });

  ctx += `\n=== TOP DEALS IN PIPE ===\n`;
  topPipe.forEach((deal) => {
    ctx += `${deal.account_name} — ${fmtK(deal.arr)} | ${[...new Set(deal.products)].join('+')} | Stage: ${deal.stage_name} | AIS: ${deal.ais_forecast || 'None'} | VP: ${deal.vp_forecast || 'None'} | ${deal.ai_ae}\n`;
  });

  ctx += `\n=== TOP CLOSED DEALS (${currentQuarter}) ===\n`;
  topCW.forEach((deal, i) => {
    ctx += `${i + 1}. ${deal.account_name} — ${fmtK(deal.bookings)} | ${[...new Set(deal.products)].join('+')} | ${deal.ai_ae}\n`;
  });

  return ctx;
}

// ── Quick prompts ──────────────────────────────────────────────

const QUICK_PROMPTS = [
  { label: 'Brief me on this quarter', emoji: '📋' },
  { label: "Who's most at risk?",      emoji: '⚠️' },
  { label: 'What is my coverage ratio?', emoji: '📊' },
  { label: 'Where should I focus?',    emoji: '🎯' },
  { label: 'Summarize team performance', emoji: '🏆' },
  { label: 'What deals should I push to close?', emoji: '💪' },
];

// ── Chat types ─────────────────────────────────────────────────

type ChatMessage = { role: 'user' | 'assistant'; content: string };

// ── Main page ──────────────────────────────────────────────────

export default function Dealia() {
  const [opps, setOpps]           = useState<ForecastOpp[]>([]);
  const [closedWon, setClosedWon] = useState<ClosedWonOpp[]>([]);
  const [quotas, setQuotas]       = useState<Quota[]>([]);
  const [loading, setLoading]     = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput]       = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      window.api.getForecastOpps(),
      window.api.getClosedWonOpps(),
      window.api.getQuotas(),
    ]).then(([o, cw, q]) => {
      setOpps(o);
      setClosedWon(cw);
      setQuotas(q);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>;

  const context = buildContext(opps, closedWon, quotas);

  async function send(text: string) {
    if (!text.trim() || thinking) return;
    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setThinking(true);
    setError(null);
    const result = await window.api.dealiaChat(next, context);
    setThinking(false);
    if (result.ok && result.reply) {
      setMessages([...next, { role: 'assistant', content: result.reply }]);
    } else {
      setError(result.error ?? 'Something went wrong.');
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Dealia</h2>
            <p className="text-sm text-gray-400 mt-0.5">Your AI pipeline analyst — ask anything</p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); setError(null); }}
              className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 transition-colors"
            >
              New conversation
            </button>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-8">
        <div className="max-w-2xl mx-auto">

          {/* Empty state */}
          {isEmpty && (
            <div className="pt-8 pb-6">
              <div className="w-12 h-12 rounded-full bg-green-600 text-white text-lg flex items-center justify-center font-bold mb-4 mx-auto">D</div>
              <p className="text-center text-gray-500 text-sm mb-8">Hi, I'm Dealia. I have your full pipeline loaded — what would you like to know?</p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_PROMPTS.map(({ label, emoji }) => (
                  <button
                    key={label}
                    onClick={() => send(label)}
                    className="flex items-center gap-2.5 text-left px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-700 hover:border-green-400 hover:bg-green-50 hover:text-green-800 transition-colors"
                  >
                    <span>{emoji}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {!isEmpty && (
            <div className="py-4 space-y-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} gap-2.5`}>
                  {m.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-green-600 text-white text-sm flex items-center justify-center font-bold shrink-0 mt-0.5">D</div>
                  )}
                  <div className={`relative group max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-gray-900 text-white rounded-br-sm'
                      : 'bg-white border border-gray-100 text-gray-800 rounded-bl-sm shadow-sm'
                  }`}>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                    {m.role === 'assistant' && (
                      <button
                        onClick={() => navigator.clipboard.writeText(m.content)}
                        className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 bg-white border border-gray-200 rounded-full w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-opacity shadow-sm text-xs"
                        title="Copy"
                      >
                        ⎘
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Thinking indicator */}
              {thinking && (
                <div className="flex justify-start gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-green-600 text-white text-sm flex items-center justify-center font-bold shrink-0">D</div>
                  <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                    <div className="flex gap-1 items-center h-4">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="text-xs text-red-500 bg-red-50 rounded-xl px-4 py-3 border border-red-100">{error}</div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input bar */}
      <div className="px-8 py-5 shrink-0 border-t border-gray-100 bg-white">
        <div className="max-w-2xl mx-auto flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(input)}
            placeholder="Ask Dealia anything about your pipeline…"
            disabled={thinking}
            className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-50 placeholder-gray-300"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || thinking}
            className="px-5 py-3 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
