import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import '../index.css';

export default function ThankYouPage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  return (
    <div className="page-center">
      <div className="card" style={{ textAlign:'center', maxWidth:480 }}>
        <div style={{ fontSize:60 }}>🎉</div>
        <h1 style={{ marginTop:16 }}>Bedankt voor je stem!</h1>
        <p style={{ marginTop:12 }}>
          Je stem is succesvol ontvangen. We sturen je ook een bevestiging per e-mail.
        </p>
        <p style={{ marginTop:10, fontSize:13, color:'#888', background:'#fffbe6', borderRadius:6, padding:'8px 12px', textAlign:'left' }}>
          📧 Geen bevestiging ontvangen? Controleer ook je <strong>spam-</strong> of <strong>ongewenste e-mail</strong> map.
        </p>
        <button className="btn" style={{ marginTop:24 }}
          onClick={() => navigate(`/stem/${slug}/resultaten`)}>
          Bekijk de tussenstand
        </button>
      </div>
    </div>
  );
}
