import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import './ChartPage.css';

const API = '/api';

const TREND = {
  new:  { label: 'NIEUW', cls: 'trend-new'  },
  up:   { label: '▲',     cls: 'trend-up'   },
  down: { label: '▼',     cls: 'trend-down' },
  same: { label: '●',     cls: 'trend-same' },
};

function isInIframe() {
  try { return window.self !== window.top; } catch { return true; }
}

export default function ChartPage() {
  const { slug }         = useParams();
  const [data, setData]  = useState(null);
  const [error, setError] = useState(null);
  const inIframe = isInIframe();

  // Stuur hoogte naar parent zodat iframe automatisch meeschaalt
  useEffect(() => {
    if (!inIframe) return;
    document.body.style.overflow = 'visible';
    document.documentElement.style.overflow = 'visible';
    const sendHeight = () => {
      window.parent.postMessage(
        { type: 'hitlijst-resize', height: document.body.scrollHeight },
        '*'
      );
    };
    sendHeight();
    const ro = new ResizeObserver(sendHeight);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [inIframe, data]);

  useEffect(() => {
    axios.get(`${API}/chart/${slug}`)
      .then(r  => setData(r.data))
      .catch(() => setError('Hitlijst niet gevonden.'));
  }, [slug]);

  if (error) return (
    <div className="chart-empty">
      <h2>{error}</h2>
    </div>
  );

  if (!data) return (
    <div className="chart-empty">
      <div className="chart-loader">Laden…</div>
    </div>
  );

  if (!data.published || data.chart.length < 25) {
    return (
      <div className="chart-empty">
        <h2>{data.list?.name}</h2>
        <p>De hitlijst is nog niet gepubliceerd.<br />Er zijn minimaal 25 nummers nodig.</p>
      </div>
    );
  }

  const { list, chart, week, year } = data;

  return (
    <div className="chart-wrap">
      {!inIframe && (
        <header className="chart-header">
          <div className="chart-header-inner">
            <h1 className="chart-title-main">{list.name}</h1>
            {list.description && <p className="chart-subtitle">{list.description}</p>}
            <div className="chart-week-badge">Week {week} · {year}</div>
          </div>
        </header>
      )}

      <div className="chart-legend">
        <span className="legend-pos">#</span>
        <span className="legend-trend">Trend</span>
        <span className="legend-info">Artiest — Nummer</span>
        <span className="legend-meta">Vr.wk / Weken</span>
      </div>

      <ol className="chart-list">
        {chart.map(track => {
          const t = TREND[track.trend] || TREND.same;
          return (
            <li key={track.track_id} className={`chart-row ${track.position <= 3 ? 'chart-row-top' : ''}`}>

              {/* Positienummer */}
              <div className={`chart-pos pos-${Math.min(track.position, 10)}`}>
                {track.position}
              </div>

              {/* Trend-indicator */}
              <div className={`chart-trend-box ${t.cls}`}>
                <span className="trend-label">{t.label}</span>
                {(track.trend === 'up' || track.trend === 'down') && track.diff > 0 && (
                  <span className="trend-diff">{track.diff}</span>
                )}
              </div>

              {/* Cover */}
              {track.cover_url
                ? <img className="chart-cover" src={track.cover_url} alt="" />
                : <div className="chart-cover chart-cover-placeholder">♪</div>
              }

              {/* Artiest + Titel */}
              <div className="chart-info">
                <div className="chart-track-title">{track.title}</div>
                <div className="chart-track-artist">{track.artist}</div>
              </div>

              {/* Stats: vorige week + weken in lijst */}
              <div className="chart-meta">
                <div className="chart-prev-pos" title="Vorige week">
                  {track.last_week_position
                    ? <span>#{track.last_week_position}</span>
                    : <span className="meta-dash">—</span>
                  }
                </div>
                <div className="chart-weeks" title="Weken in de lijst">
                  {track.weeks_in_chart}
                  <span className="weeks-label"> wk</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="chart-footer">
        Domstad Radio · Week {week}, {year}
      </footer>
    </div>
  );
}
