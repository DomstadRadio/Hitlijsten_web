import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../index.css';

const API = '/api';

export default function VerifyPage() {
  const { slug, token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [data,   setData]   = useState(null);

  useEffect(() => {
    axios.get(`${API}/vote/${slug}/verify/${token}`)
      .then(res => { setData(res.data); setStatus('ok'); })
      .catch(() => setStatus('error'));
  }, [slug, token]);

  if (status === 'loading') return <div className="page-center"><p>Verificeren…</p></div>;
  if (status === 'error') return (
    <div className="page-center">
      <div className="card" style={{ textAlign:'center', maxWidth:440 }}>
        <h2>❌ Ongeldige link</h2>
        <p style={{ marginTop:12 }}>Deze link is ongeldig of verlopen.</p>
      </div>
    </div>
  );

  return (
    <div className="page-center">
      <div className="card" style={{ textAlign:'center', maxWidth:440 }}>
        <h2>✅ E-mail bevestigd!</h2>
        <p style={{ marginTop:12 }}>
          Je kunt nu stemmen voor <strong>{data.listName}</strong>.<br />
          Je kiest maximaal <strong>{data.maxVotes}</strong> nummers.
        </p>
        <button className="btn" style={{ marginTop:20 }}
          onClick={() => navigate(`/stem/${slug}/stemmen/${token}`)}>
          Begin met stemmen →
        </button>
      </div>
    </div>
  );
}
