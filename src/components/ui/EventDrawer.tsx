"use client";

import { useState, useRef, useEffect } from "react";
import { useEvidenceStore } from "@/lib/store";

export function EventDrawer() {
  const [open, setOpen] = useState(false);
  const events = useEvidenceStore((s) => s.events);
  const stage = useEvidenceStore((s) => s.stage);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new events arrive
  useEffect(() => {
    if (logRef.current && open) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events, open]);

  if (stage === "idle") return null;

  return (
    <aside
      className={`event-drawer ${open ? "drawer-open" : "drawer-collapsed"}`}
      aria-label="Event Log and Accessible Transcript"
    >
      <button
        type="button"
        className="drawer-toggle-btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="event-log-drawer"
      >
        <span className="drawer-indicator-dot" />
        <span className="drawer-btn-label">
          {open ? "COLLAPSE LOG" : `LOG (${events.length})`}
        </span>
      </button>

      {open && (
        <div id="event-log-drawer" className="drawer-content">
          <div className="drawer-header">
            <span className="drawer-title">LIVE TELEMETRY</span>
            <span className="drawer-count">{events.length} events</span>
          </div>

          <div ref={logRef} className="drawer-log-list" tabIndex={0} role="region" aria-label="Streaming agent events">
            {events.length === 0 ? (
              <div className="drawer-empty">Listening for agent emissions...</div>
            ) : (
              events.map((ev, i) => {
                const time = new Date(ev.timestamp).toLocaleTimeString([], {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
                return (
                  <div key={i} className={`drawer-item item-${ev.status}`}>
                    <span className="item-time">{time}</span>
                    <span className="item-agent">[{ev.agent}]</span>
                    {ev.tool_call && (
                      <span className="item-tool">::{ev.tool_call}</span>
                    )}
                    <span className="item-summary">
                      {ev.result_summary ?? ev.input_summary ?? ev.status}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
