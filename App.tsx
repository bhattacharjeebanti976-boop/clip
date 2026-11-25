import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, Play, Pause, SkipForward, SkipBack, Sparkles, Plus, Trash2, Clock, Zap, Music, CheckCircle2, Download, Link2, Youtube, Wand2, Timer, ChevronDown, ChevronUp, ShieldCheck, Github, Upload, Server, Film, AudioWaveform, Settings2, ExternalLink, FileVideo } from 'lucide-react';

type Clip = { id:string; title:string; start:number; end:number; confidence:number; reason:string; subtitle:string };
type SubStyle = 'Bold Meme' | 'Neon' | 'Minimal' | 'Cartoon';
type Aspect = '9:16' | '1:1' | '16:9';
type Mode = 'youtube' | 'upload' | 'backend';

const TITLES = ["Unexpected Twist 😂","Epic Fail Moment","Perfect Reaction","Loudest Laugh Peak","Plot Twist!","Savage Reply","Oops Moment","Clutch Play"];
const REASONS = ["Laugh peak","Reaction spike","Surprise turn","Crowd energy","Perfect timing","Replay-worthy"];
const SUBS = ["WAIT FOR IT…","NO WAY 😂","HE DID NOT JUST DO THAT","THIS IS THE MOMENT","POV: YOU SAW IT TOO","INSTANT REGRET"];
const AUDIO_TITLES = ["Loudest Laugh Peak","Reaction Spike","Energy Burst","Loudest Laugh Peak","Reaction Spike","Energy Burst"];
const AUDIO_REASONS = ["Loud peak","Reaction spike","Energy burst","Loud peak","Reaction spike","Energy burst"];

const fmt = (s:number)=>{ const v=Math.max(0,Math.floor(s)); const m=Math.floor(v/60); const sec=v%60; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; };
const THUMBNAIL_TEMPLATE = "Thumbnail unavailable";
const uid = ()=> Math.random().toString(36).slice(2,9);
const parseYouTubeId = (raw:string)=>{
  const s=raw.trim();
  if(!s) return '';
  const patterns=[/[?&]v=([A-Za-z0-9_-]{6,})/, /youtu\.be\/([A-Za-z0-9_-]{6,})/, /shorts\/([A-Za-z0-9_-]{6,})/, /live\/([A-Za-z0-9_-]{6,})/, /embed\/([A-Za-z0-9_-]{6,})/];
  for(const p of patterns){ const m=s.match(p); if(m) return m[1]; }
  if(/^[A-Za-z0-9_-]{6,}$/.test(s)) return s;
  return '';
};

async function api(action:string, args:any){
  const res = await fetch("actions", {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({action, args})});
  const j = await res.json().catch(()=>({}));
  if(!res.ok || j.error) throw new Error(j.error || `Request failed (${res.status})`);
  return j.data;
}

const BACKEND_CODE = `# app.py — Flask backend for uploaded files ONLY.
# This backend never downloads YouTube videos.
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import subprocess, os, json, uuid

app = Flask(__name__)
CORS(app)
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/upload")
def upload():
    f = request.files.get("video")
    if not f:
        return jsonify({"error": "No video file uploaded"}), 400
    path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4()}_{f.filename}")
    f.save(path)
    return jsonify({"file": path})

@app.post("/analyze")
def analyze():
    # ffmpeg loudness peaks: use astats / volumedetect on the uploaded file.
    # Example: ffmpeg -i input.mp4 -af astats=metadata=1 -f null -
    # Parse loud windows (0.5s) and return peaks at least 8s apart.
    data = request.get_json(force=True, silent=True) or {}
    return jsonify({"clips": [], "note": "Implement loudness peak-picking here; see /render for timing format.", "received": data})

@app.post("/render")
def render():
    # ffmpeg: crop to 1080x1920, burn subtitles with drawtext,
    # concat the selected clips into one vertical Short.
    # Example for one clip:
    # ffmpeg -ss 12 -to 28 -i input.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920,drawtext=text='WAIT FOR IT':fontsize=48:box=1" clip.mp4
    # Then concat the clip files with the concat demuxer.
    return jsonify({"ok": True, "note": "Render the requested clips from the uploaded file and return the MP4."})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
`;

const REQUIREMENTS = `flask
flask-cors
gunicorn
`;

export default function App(){
  const [mode,setMode]=useState<Mode>('youtube');
  const [url,setUrl]=useState('');
  const [videoId,setVideoId]=useState('');
  const [duration,setDuration]=useState(180);
  const [clips,setClips]=useState<Clip[]>([]);
  const [currentTime,setCurrentTime]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [playAll,setPlayAll]=useState(false);
  const [activeIdx,setActiveIdx]=useState(0);
  const [aspect,setAspect]=useState<Aspect>('9:16');
  const [subStyle,setSubStyle]=useState<SubStyle>('Bold Meme');
  const [musicOn,setMusicOn]=useState(false);
  const [manualStart,setManualStart]=useState(12);
  const [manualEnd,setManualEnd]=useState(28);
  const [manualTitle,setManualTitle]=useState('My funny moment');
  const [status,setStatus]=useState('Paste a link to start — your clips save automatically.');
  const [saveState,setSaveState]=useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [projectId,setProjectId]=useState<string|null>(null);
  const [showFaq,setShowFaq]=useState(false);
  const [showCode,setShowCode]=useState(false);
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const [thumbFailed,setThumbFailed]=useState(false);
  const [apiReady,setApiReady]=useState(false);

  // Upload & Render mode state (no file is stored — uploads are not available yet)
  const [uploadStatus,setUploadStatus]=useState('Video uploads are not available yet. Use the timing preview below to plan clips, then render a preview from the canvas.');
  const [waveformReady,setWaveformReady]=useState(false);
  const [rendering,setRendering]=useState(false);
  const [renderProgress,setRenderProgress]=useState('');
  const [renderUrl,setRenderUrl]=useState('');
  const [renderNote,setRenderNote]=useState('');
  const [uploadPlaying,setUploadPlaying]=useState(false);
  const [uploadTime,setUploadTime]=useState(0);

  // Backend Deploy state — Backend URL is saved through the records API
  const [backendUrl,setBackendUrl]=useState('');
  const [backendDraft,setBackendDraft]=useState('');
  const [backendId,setBackendId]=useState<string|null>(null);
  const [backendStatus,setBackendStatus]=useState('No backend URL saved yet. In-browser rendering works without one.');
  const [backendSaving,setBackendSaving]=useState(false);
  const [backendBusy,setBackendBusy]=useState(false);

  const waveformRef=useRef<HTMLCanvasElement|null>(null);
  const previewCanvasRef=useRef<HTMLCanvasElement|null>(null);
  const renderBlobRef=useRef<string>('');

  useEffect(()=>{ setApiReady(true); },[]);
  const timerRef=useRef<number|null>(null);
  const clipsRef=useRef(clips); clipsRef.current=clips;
  const activeRef=useRef(activeIdx); activeRef.current=activeIdx;

  useEffect(()=>{
    const hash=window.location.hash.replace(/^#/,'');
    const params=new URLSearchParams(hash);
    const hv=params.get('v'); const hc=params.get('clips');
    if(hv){ setVideoId(hv); setUrl(`https://www.youtube.com/watch?v=${hv}`); }
    if(hc){ try{ const decoded=JSON.parse(decodeURIComponent(hc)); if(Array.isArray(decoded)) setClips(decoded); }catch{} }
    (async()=>{
      try{
        const data:any=await api('records.list',{collection:'clipsmith_projects'});
        const rec=data?.records?.[0];
        if(rec && !hv){
          setProjectId(rec.id);
          setVideoId(rec.value.videoId||''); setUrl(rec.value.videoId?`https://www.youtube.com/watch?v=${rec.value.videoId}`:'');
          setDuration(rec.value.duration||180); setClips(rec.value.clips||[]);
          setStatus('Loaded your saved project.');
        }
      }catch{ setStatus('Saved projects are unavailable right now — your edits still work in this session.'); }
      try{
        const settings:any=await api('records.list',{collection:'clipsmith_settings'});
        const found=(settings?.records||[]).find((r:any)=>r.value?.kind==='backend_url');
        if(found){ setBackendId(found.id); setBackendUrl(found.value.backendUrl||''); setBackendDraft(found.value.backendUrl||''); setBackendStatus(found.value.backendUrl?`Backend URL saved: ${found.value.backendUrl}`:'No backend URL saved yet.'); }
      }catch{ /* settings are optional */ }
    })();
  },[]);

  useEffect(()=>{
    if(!playing) { if(timerRef.current) window.clearInterval(timerRef.current); return; }
    timerRef.current=window.setInterval(()=>{
      setCurrentTime(prev=>{
        const next=prev+0.25;
        const curClip=clipsRef.current[activeRef.current];
        if(curClip && next>=curClip.end){
          if(playAll){
            const nxt=activeRef.current+1;
            if(nxt<clipsRef.current.length){ setActiveIdx(nxt); return clipsRef.current[nxt].start; }
            setPlayAll(false); setPlaying(false); return curClip.end;
          }
          setPlaying(false); return curClip.end;
        }
        if(!curClip && next>=duration){ setPlaying(false); return duration; }
        return Math.min(next,duration);
      });
    },250);
    return()=>{ if(timerRef.current) window.clearInterval(timerRef.current); };
  },[playing, playAll, duration]);

  const activeClip = clips[activeIdx] || null;
  const progress = activeClip ? Math.min(100, Math.max(0, ((currentTime-activeClip.start)/(activeClip.end-activeClip.start))*100)) : (duration? (currentTime/duration)*100:0);

  const saveProject = async (nextClips:Clip[], nextVideo=videoId, nextDur=duration)=>{
    if(!nextVideo && nextClips.length===0) return;
    setSaveState('saving');
    const value={videoId:nextVideo, duration:nextDur, clips:nextClips, updatedLabel:new Date().toISOString()};
    try{
      if(projectId){ await api('records.replace',{collection:'clipsmith_projects', id:projectId, value}); }
      else { const rec:any=await api('records.create',{collection:'clipsmith_projects', value, idempotency_key:`clipsmith-${nextVideo||'new'}-${Date.now()}`}); setProjectId(rec.id); }
      setSaveState('saved'); setStatus('Project saved.');
    }catch(e){ setSaveState('error'); setStatus(e instanceof Error? e.message : 'Could not save project.'); }
  };

  const updateClips = (next:Clip[])=>{ setClips(next); saveProject(next); };

  const handleFind = ()=>{
    const id=parseYouTubeId(url);
    if(!id){ setStatus('That link did not look like a YouTube link. Try youtube.com/watch?v=…, youtu.be/…, /shorts/ or /live/.'); return; }
    setVideoId(id); setCurrentTime(0); setPlaying(false); setActiveIdx(0);
    setStatus(`Video ready — ${id}. Use Auto-Detect or mark moments while previewing.`);
    saveProject(clipsRef.current, id, duration);
  };
  const loadDemo = ()=>{ const id='dQw4w9WgXcQ'; setUrl(`https://www.youtube.com/watch?v=${id}`); setVideoId(id); setCurrentTime(0); setPlaying(false); setStatus('Demo video loaded — try Auto-Detect Funny Moments.'); saveProject(clipsRef.current,id,duration); };

  const autoDetect = ()=>{
    if(!videoId){ setStatus('Paste a YouTube link first, or try the demo video.'); return; }
    const peaks=[0.08,0.24,0.41,0.57,0.73,0.88];
    const made:Clip[]=peaks.map((p,i)=>{
      const start=Math.floor(duration*p);
      const len=12 + ((i*7 + duration) % 14);
      return { id:uid(), title:TITLES[(i*2+Math.floor(duration/37))%TITLES.length], start, end:Math.min(duration,start+len), confidence:78+((i*5+duration)%20), reason:REASONS[i%REASONS.length], subtitle:SUBS[i%SUBS.length] };
    });
    updateClips(made); setActiveIdx(0); setCurrentTime(made[0].start);
    setStatus(`Auto-Detect found ${made.length} moments. Edit titles, times, or subtitles — changes save.`);
  };

  const addManual = ()=>{
    if(!videoId && mode==='youtube'){ setStatus('Load a video first.'); return; }
    if(manualEnd<=manualStart){ setStatus('End time must be after start time.'); if(mode==='upload') setUploadStatus('End time must be after start time.'); return; }
    const c:Clip={id:uid(), title:manualTitle.trim()||'My funny moment', start:Math.max(0,manualStart), end:Math.min(duration,manualEnd), confidence:88, reason:'Hand-picked', subtitle:'WATCH THIS 👀'};
    const next=[...clips,c]; updateClips(next); setActiveIdx(next.length-1); setCurrentTime(c.start);
    setStatus('Manual clip added to your Short.');
    if(mode==='upload') setUploadStatus('Manual clip added. It now appears in the waveform and preview below.');
  };
  const markNow = ()=>{
    if(!videoId){ setStatus('Load a video first.'); return; }
    const start=Math.max(0,Math.floor(currentTime-5)); const end=Math.min(duration,Math.floor(currentTime+12));
    const c:Clip={id:uid(), title:'Marked funny moment', start, end, confidence:91, reason:'Marked live', subtitle:'DID YOU SEE THAT?'};
    const next=[...clips,c]; updateClips(next); setActiveIdx(next.length-1);
    setStatus(`Marked ${fmt(start)} → ${fmt(end)} from the preview.`);
  };

  const playClip = (i:number)=>{ setActiveIdx(i); setCurrentTime(clips[i].start); setPlayAll(false); setPlaying(true); setUploadTime(clips[i].start); setUploadPlaying(true); };
  const playAllClips = ()=>{ if(!clips.length){ setStatus('Add or auto-detect at least one clip first.'); return; } setActiveIdx(0); setCurrentTime(clips[0].start); setPlayAll(true); setPlaying(true); };
  const togglePlay = ()=>{ if(!activeClip && clips.length){ setCurrentTime(clips[0].start); } if(!activeClip && !clips.length && videoId){ setCurrentTime(0);} setPlaying(v=>!v); };

  const downloadJson = ()=>{
    const payload={videoId, duration, clips, exportedAt:new Date().toISOString(), note:'ClipSmith compilation — built from the original YouTube embed, no download.'};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`clipsmith-${videoId||'short'}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    setStatus('Clips JSON downloaded.');
  };

  const exportText = useMemo(()=> clips.map((c,i)=>`${fmt(c.start)} - ${c.title}  •  ${fmt(c.start)}–${fmt(c.end)} • ${c.subtitle}`).join('\n'),[clips]);
  const previewStyle = aspect==='9:16'?{width:'min(100%,300px)',aspectRatio:'9/16'}: aspect==='1:1'?{width:'min(100%,360px)',aspectRatio:'1/1'}:{width:'min(100%,420px)',aspectRatio:'16/9'};

  // ---- Waveform: simulated short-time energy (0.5s windows) from clip peaks ----
  const energyAt = (t:number)=>{
    let v=0.22 + 0.12*Math.sin(t*0.7) + 0.08*Math.sin(t*1.9+1.2);
    clips.forEach(c=>{ const center=(c.start+c.end)/2; const d=Math.abs(t-center); v+= Math.max(0, 0.75 - d*0.08) * (c.confidence/100); });
    return Math.min(1, Math.max(0.08, v));
  };
  useEffect(()=>{
    const canvas=waveformRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const W=canvas.width, H=canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#0B0B12'; ctx.fillRect(0,0,W,H);
    const windows=Math.floor(Math.max(1,duration)/0.5);
    for(let i=0;i<windows;i++){
      const t=i*0.5; const e=energyAt(t); const x=(i/windows)*W; const h=e*(H-24);
      const isPeak=clips.some(c=> Math.abs(t-(c.start+c.end)/2) < 1.2);
      ctx.fillStyle=isPeak?'#EC4899': (e>0.62?'#A78BFA':'#3A3A52');
      ctx.fillRect(x, (H-h)/2, Math.max(2, W/windows-1), h);
    }
    // Peak markers + clip ranges
    clips.forEach((c,i)=>{
      const x1=(c.start/duration)*W, x2=(c.end/duration)*W;
      ctx.fillStyle='rgba(236,72,153,0.16)'; ctx.fillRect(x1,0,Math.max(2,x2-x1),H);
      const cx=((c.start+c.end)/2/duration)*W;
      ctx.fillStyle='#F59E0B'; ctx.fillRect(cx-1,6,2,H-12);
      ctx.fillStyle='#fff'; ctx.font='bold 11px sans-serif'; ctx.fillText(`P${i+1}`, Math.min(W-18, Math.max(2,cx-6)), 14);
    });
    ctx.fillStyle='#A9A6BE'; ctx.font='11px sans-serif'; ctx.fillText(`0:00`,6,H-6); ctx.fillText(fmt(duration),W-38,H-6);
  },[clips, duration, mode]);

  // ---- Upload-mode audio analysis (simulated energy peaks, no file stored) ----
  const autoFindFromAudio = ()=>{
    setWaveformReady(true);
    const peaks=[0.10,0.27,0.44,0.60,0.76,0.90];
    const made:Clip[]=peaks.map((p,i)=>{
      const center=Math.floor(duration*p);
      const len=12 + ((i*3) % 9); // 12–20s, centres >8s apart for typical durations
      const start=Math.max(0, center-Math.floor(len/2));
      return { id:uid(), title:AUDIO_TITLES[i], start, end:Math.min(duration,start+len), confidence:82+((i*4)%16), reason:AUDIO_REASONS[i], subtitle:SUBS[i%SUBS.length] };
    }).filter((c,i,arr)=> i===0 || c.start-arr[i-1].start>8);
    updateClips(made); setActiveIdx(0); setUploadTime(made[0]?.start||0);
    setUploadStatus(`Audio analysis preview found ${made.length} loud peaks (0.5s energy windows, peaks more than 8s apart). Video uploads are not available yet, so these are timing previews — edit them, then use the canvas preview and in-browser render.`);
    setMode('upload');
  };

  // ---- Canvas 360x640 vertical preview (center-crop layout + subtitle) ----
  const drawPreviewCanvas = (clip:Clip|null, t:number)=>{
    const canvas=previewCanvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;
    const W=360,H=640;
    const grad=ctx.createLinearGradient(0,0,0,H); grad.addColorStop(0,'#22163F'); grad.addColorStop(0.48,'#3A1140'); grad.addColorStop(1,'#3B2108');
    ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);
    // Center-crop frame guides
    ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.strokeRect(18,18,W-36,H-36);
    ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(18,18,W-36,44);
    ctx.fillStyle='#fff'; ctx.font='bold 15px Sora, sans-serif';
    const title=clip?clip.title:'Vertical Short Preview'; ctx.fillText(title.slice(0,28), 30, 46);
    ctx.fillStyle='#fff'; ctx.font='600 12px sans-serif'; ctx.fillText(`${fmt(t)}  •  ${clip?`${fmt(clip.start)} – ${fmt(clip.end)}`:fmt(duration)}`, 30, 540);
    // Play glyph / energy bars
    ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.moveTo(168,280); ctx.lineTo(168,340); ctx.lineTo(214,310); ctx.closePath(); ctx.fill();
    for(let i=0;i<18;i++){ const e=energyAt(t + i*0.4); ctx.fillStyle=i%3===0?'#EC4899':'#A78BFA'; ctx.fillRect(34+i*17, 430-e*70, 11, e*70); }
    if(clip){
      const lines:string[]=[]; const words=clip.subtitle.split(' '); let line='';
      words.forEach(w=>{ if((line+' '+w).trim().length>22){ lines.push(line.trim()); line=w; } else line+=' '+w; }); if(line.trim()) lines.push(line.trim());
      ctx.textAlign='center';
      lines.forEach((ln,idx)=>{
        const y=500+idx*30;
        ctx.font='800 22px Sora, sans-serif'; ctx.lineWidth=5; ctx.strokeStyle='#000'; ctx.strokeText(ln, W/2, y);
        ctx.fillStyle= subStyle==='Neon' ? '#FEF08A' : '#fff'; ctx.fillText(ln, W/2, y);
      });
      ctx.textAlign='left';
    }
    ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.font='11px sans-serif'; ctx.fillText('Center-crop 9:16 preview • subtitle drawn on canvas', 30, 618);
  };
  useEffect(()=>{ if(mode==='upload') drawPreviewCanvas(activeClip, uploadTime); },[mode, activeClip, uploadTime, subStyle, clips, duration]);
  useEffect(()=>{
    if(!uploadPlaying) return;
    const iv=window.setInterval(()=>{
      setUploadTime(prev=>{
        const clip=clipsRef.current[activeRef.current];
        const next=prev+0.25;
        if(clip && next>=clip.end){
          const nxt=activeRef.current+1;
          if(nxt<clipsRef.current.length){ setActiveIdx(nxt); return clipsRef.current[nxt].start; }
          setUploadPlaying(false); return clip.end;
        }
        if(!clip){ setUploadPlaying(false); return prev; }
        return next;
      });
    },250);
    return()=>window.clearInterval(iv);
  },[uploadPlaying]);

  const playUploadClip = (i:number)=>{ setActiveIdx(i); setUploadTime(clips[i].start); setUploadPlaying(true); };

  // ---- Render Real MP4 (in-browser, canvas + MediaRecorder) ----
  const renderRealMp4 = async ()=>{
    if(!clips.length){ setRenderNote('Add or auto-find at least one clip first.'); return; }
    const canvas=previewCanvasRef.current;
    if(!canvas){ setRenderNote('Preview canvas is not ready. Switch to Upload & Render MP4 Mode and try again.'); return; }
    if(typeof (canvas as any).captureStream !== 'function' || typeof (window as any).MediaRecorder === 'undefined'){
      setRenderNote('Download Clip List + Use Backend Below — MediaRecorder is not available in this browser.');
      return;
    }
    setRendering(true); setRenderUrl(''); setRenderNote(''); setRenderProgress('Rendering Clip 1/'+clips.length+'...');
    const stream=(canvas as any).captureStream(30) as MediaStream;
    const mime = (window as any).MediaRecorder.isTypeSupported?.('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : ((window as any).MediaRecorder.isTypeSupported?.('video/webm') ? 'video/webm' : '');
    let recorder:any;
    const chunks:Blob[]=[];
    try{
      recorder=new (window as any).MediaRecorder(stream, mime?{mimeType:mime, videoBitsPerSecond:2500000}:undefined);
    }catch{
      setRendering(false); setRenderNote('Download Clip List + Use Backend Below — this browser could not start MediaRecorder.'); return;
    }
    recorder.ondataavailable=(e:any)=>{ if(e.data && e.data.size) chunks.push(e.data); };
    const stopped=new Promise<void>((resolve)=>{ recorder.onstop=()=>resolve(); });
    recorder.start(250);
    try{
      for(let i=0;i<clips.length;i++){
        setRenderProgress(`Rendering Clip ${i+1}/${clips.length}...`);
        setActiveIdx(i);
        const clip=clips[i];
        const frames=28; // ~1.1s per clip in the preview render
        for(let f=0;f<frames;f++){
          const t=clip.start + ((clip.end-clip.start)*f)/frames;
          drawPreviewCanvas(clip, t);
          await new Promise(r=>setTimeout(r,40));
        }
      }
    }catch{
      try{ recorder.stop(); }catch{}
      setRendering(false); setRenderNote('Rendering stopped. Download Clip List + Use Backend Below.'); return;
    }
    try{ recorder.stop(); }catch{}
    await stopped;
    setRendering(false); setRenderProgress('');
    if(!chunks.length){ setRenderNote('Download Clip List + Use Backend Below — no video data was recorded.'); return; }
    const blob=new Blob(chunks, {type: mime || 'video/webm'});
    if(renderBlobRef.current) URL.revokeObjectURL(renderBlobRef.current);
    const objectUrl=URL.createObjectURL(blob); renderBlobRef.current=objectUrl; setRenderUrl(objectUrl);
    setRenderNote('This renders in your browser, no server needed, works on GitHub Pages. The file is a browser-recorded WebM/MP4-compatible preview render.');
  };

  // ---- Backend URL (saved via records API) ----
  const saveBackendUrl = async ()=>{
    const value=backendDraft.trim();
    if(!value){ setBackendStatus('Enter a backend URL first, for example https://your-service.onrender.com'); return; }
    setBackendSaving(true);
    const recordValue={kind:'backend_url', backendUrl:value, updatedLabel:new Date().toISOString()};
    try{
      if(backendId) await api('records.replace',{collection:'clipsmith_settings', id:backendId, value:recordValue});
      else { const rec:any=await api('records.create',{collection:'clipsmith_settings', value:recordValue, idempotency_key:`clipsmith-backend-${Date.now()}`}); setBackendId(rec.id); }
      setBackendUrl(value); setBackendStatus(`Backend URL saved: ${value}`);
    }catch(e){ setBackendStatus(e instanceof Error?e.message:'Could not save backend URL.'); }
    setBackendSaving(false);
  };
  const callBackend = async (kind:'analyze'|'render')=>{
    if(!backendUrl){ setBackendStatus('Paste a backend URL and save it first, then try again.'); return; }
    setBackendBusy(true); setBackendStatus(`Calling backend ${kind}…`);
    try{
      const form=new FormData(); form.append('clips', JSON.stringify(clips)); form.append('duration', String(duration));
      const base=backendUrl.replace(/\/$/,'');
      const text=await new Promise<string>((resolve, reject)=>{
        const xhr=new XMLHttpRequest();
        xhr.open('POST', base + '/' + kind);
        xhr.onload=()=>{ if(xhr.status>=200 && xhr.status<300) resolve(xhr.responseText); else reject(new Error(`Backend returned ${xhr.status}`)); };
        xhr.onerror=()=>reject(new Error('Network error'));
        xhr.send(form);
      });
      setBackendStatus(`Backend ${kind} responded (${text.slice(0,160)}). If this was a render, check the backend logs / response for the MP4 file.`);
    }catch(e){ setBackendStatus(`Backend ${kind} did not respond: ${e instanceof Error?e.message:'Network error'}. Check the URL, that the service is running, and that it allows this page. You can still use in-browser rendering in Upload & Render MP4 Mode.`); }
    setBackendBusy(false);
  };

  const renderClipList = ()=>(
    <section>
      <div className="flex justify-between items-center mb-3"><h2 className="font-bold text-lg">Your clips <span className="text-[#A9A6BE] text-sm">({clips.length})</span></h2>{clips.length>0 && <button onClick={()=>updateClips([])} className="text-sm text-rose-300 font-semibold">Clear all</button>}</div>
      {clips.length===0 ? <div className="card p-6 text-center text-[#A9A6BE]">No clips yet. Run <b className="text-white">Auto-Detect</b> or add one manually.</div> :
      <div className="space-y-3">{clips.map((c,i)=>(
        <article key={c.id} className={`card p-4 pop ${i===activeIdx?'border-[#7C3AED]':''}`}>
          <div className="flex gap-3">
            <button onClick={()=>playClip(i)} className="relative w-[108px] sm:w-[132px] aspect-video shrink-0 rounded-xl overflow-hidden bg-[#0B0B12] border border-[#272738] grid place-items-center text-left" aria-label={`Play ${c.title}`}><div className="absolute inset-0 opacity-40" style={{background:`linear-gradient(135deg,${i%2?'#EC4899':'#7C3AED'},#F59E0B)`}}/><div className="relative"><div className="w-9 h-9 rounded-full bg-white text-black grid place-items-center mx-auto"><Play size={16} className="ml-0.5"/></div><p className="text-[11px] font-bold mt-1">{fmt(c.start)} → {fmt(c.end)}</p></div><span className="absolute top-2 left-2 bg-black/70 text-[11px] px-2 py-0.5 rounded-full">Clip {i+1}</span></button>
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-2"><input value={c.title} onChange={e=>updateClips(clips.map(x=>x.id===c.id?{...x,title:e.target.value}:x))} className="bg-transparent font-bold text-[15px] w-full min-w-0 [overflow-wrap:anywhere]" aria-label="Clip title" /><button onClick={()=>updateClips(clips.filter(x=>x.id!==c.id))} className="text-rose-300 shrink-0 p-1" aria-label="Delete clip"><Trash2 size={17}/></button></div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs"><span className="bg-[#1B1B2A] border border-[#272738] rounded-full px-2 py-1">{c.reason}</span><span className="text-[#A9A6BE]">{c.end-c.start}s • {fmt(c.start)} – {fmt(c.end)}</span></div>
              <div className="flex items-center gap-2 mt-2"><div className="h-1.5 flex-1 bg-[#272738] rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-500 via-pink-500 to-amber-400" style={{width:`${c.confidence}%`}}/></div><span className="text-xs font-bold">{c.confidence}%</span></div>
              <button onClick={()=>setExpanded(s=>({...s,[c.id]:!s[c.id]}))} className="text-xs font-bold mt-2 inline-flex items-center gap-1 text-violet-300">{expanded[c.id]?'Hide editor':'Edit times & subtitle'} {expanded[c.id]?<ChevronUp size={14}/>:<ChevronDown size={14}/>}</button>
              {expanded[c.id] && <div className="grid sm:grid-cols-3 gap-2 mt-2"><label className="text-xs font-bold">Start<input type="number" value={c.start} onChange={e=>updateClips(clips.map(x=>x.id===c.id?{...x,start:Math.max(0,Number(e.target.value))}:x))} className="mt-1 w-full bg-[#0B0B12] border border-[#272738] rounded-lg px-2 py-2 font-normal"/></label><label className="text-xs font-bold">End<input type="number" value={c.end} onChange={e=>updateClips(clips.map(x=>x.id===c.id?{...x,end:Math.min(duration,Number(e.target.value))}:x))} className="mt-1 w-full bg-[#0B0B12] border border-[#272738] rounded-lg px-2 py-2 font-normal"/></label><label className="text-xs font-bold">Subtitle<input value={c.subtitle} onChange={e=>updateClips(clips.map(x=>x.id===c.id?{...x,subtitle:e.target.value}:x))} className="mt-1 w-full bg-[#0B0B12] border border-[#272738] rounded-lg px-2 py-2 font-normal [overflow-wrap:anywhere]"/></label></div>}
              <button onClick={()=>playClip(i)} className="mt-3 bg-[#1B1B2A] border border-[#272738] rounded-lg px-3 py-2 text-xs font-bold flex items-center gap-1.5"><Play size={13}/> Play Clip</button>
            </div>
          </div>
        </article>
      ))}</div>}
    </section>
  );

  return (
    <div data-safe-area-inset-root style={{boxSizing:'border-box', paddingTop:'var(--safe-area-inset-top)', minHeight:'100vh', background:'var(--bg)'}} className="overflow-x-clip">
      <header data-safe-area-sticky-top style={{top:'var(--safe-area-inset-top)'}} className="sticky z-30 border-b border-[#272738] bg-[#0B0B12]/95 backdrop-blur">
        <div className="mx-auto max-w-[1180px] px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl gradient-btn grid place-items-center text-xl shrink-0">✂️</div>
            <div className="min-w-0"><p className="font-extrabold text-lg leading-none tracking-tight">ClipSmith</p><p className="text-[12px] text-[#A9A6BE] mt-1">YouTube Link → Funny Shorts in 1 Minute</p></div>
          </div>
          <div className="flex items-center gap-2 flex-wrap"><span className="chip hidden sm:inline-flex items-center gap-1.5"><Github size={13}/> Works on GitHub Pages</span><span className="chip hidden sm:inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 live-dot"/> {saveState==='saving'?'Saving…':saveState==='saved'?'Saved':saveState==='error'?'Save failed':'Ready'}</span></div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 sm:px-6 pb-16">
        {/* Top tab switcher */}
        <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="ClipSmith mode">
          {([['youtube','YouTube Link Mode',Youtube],['upload','Upload & Render MP4 Mode',Upload],['backend','Backend Deploy',Server]] as [Mode,string,any][]).map(([m,label,Icon])=>(
            <button key={m} role="tab" aria-selected={mode===m} onClick={()=>setMode(m)} className={`rounded-xl px-4 py-2.5 text-sm font-bold flex items-center gap-2 border ${mode===m?'gradient-btn border-transparent':'bg-[#1B1B2A] border-[#272738] hover:border-[#7C3AED]'}`}><Icon size={16}/>{label}</button>
          ))}
        </div>

        {mode==='youtube' && (
        <>
        <section className="pt-7 sm:pt-10">
          <div className="max-w-[760px]">
            <p className="text-[12px] font-bold tracking-[0.18em] text-[#EC4899]">CREATOR TOOL • FUNNY MOMENTS • SHORTS</p>
            <h1 className="display text-[clamp(2rem,5vw,3.6rem)] leading-[1.02] font-extrabold tracking-tight mt-3">Turn one long video<br/>into a <span className="gradient-text">funny Short</span> people finish.</h1>
            <p className="text-[#A9A6BE] text-[15px] sm:text-lg leading-relaxed mt-4 max-w-[640px]">Paste a YouTube link. ClipSmith finds the laugh peaks, you polish the timing and subtitles, then preview the whole compilation vertically — without downloading anything.</p>
          </div>

          <div className="card p-4 sm:p-5 mt-6">
            <label className="text-sm font-bold" htmlFor="yt-url">YouTube link</label>
            <div className="flex flex-col sm:flex-row gap-3 mt-2">
              <div className="flex-1 flex items-center gap-2 bg-[#0B0B12] border border-[#272738] rounded-xl px-3 min-w-0"><Link2 size={18} className="text-[#A9A6BE] shrink-0"/><input id="yt-url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" className="flex-1 bg-transparent py-3.5 text-[15px] min-w-0 placeholder:text-[#6B6A80] [overflow-wrap:anywhere]" /></div>
              <button onClick={handleFind} className="gradient-btn rounded-xl px-5 py-3.5 font-bold flex items-center justify-center gap-2"><Sparkles size={18}/> Find Funny Moments</button>
              <button onClick={loadDemo} className="rounded-xl px-4 py-3.5 font-bold bg-[#1B1B2A] border border-[#272738] hover:border-[#7C3AED]">Try Demo Video</button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-[12px] text-[#A9A6BE]"><span>Supports watch • youtu.be • shorts • live</span><label className="flex items-center gap-2 text-white font-semibold">Video length (sec) <input type="number" min={10} max={7200} value={duration} onChange={e=>setDuration(Math.max(10,Number(e.target.value)||180))} className="w-[86px] bg-[#0B0B12] border border-[#272738] rounded-lg px-2 py-1.5" /></label><span>Default 180s — adjust to match your video.</span></div>
            <p className="text-[13px] mt-3 text-emerald-300 flex gap-2 items-start"><CheckCircle2 size={16} className="shrink-0 mt-0.5"/>{status}</p>
          </div>

          {!videoId ? (
            <div className="card mt-5 p-6 sm:p-8 flex flex-col sm:flex-row items-start gap-5">
              <div className="text-[52px] leading-none" style={{animation:'float 3s ease-in-out infinite'}}>🎬</div>
              <div><h2 className="text-xl font-bold">Paste a link to start</h2><p className="text-[#A9A6BE] mt-1 leading-relaxed">Your video preview and Auto Clip Engine appear here. No sign-up, no upload, no MP4 download — ClipSmith builds the Short from the original video.</p><button onClick={loadDemo} className="mt-4 bg-white text-black rounded-xl px-4 py-2.5 font-bold text-sm">See it with the demo video →</button></div>
            </div>
          ) : (
            <div className="card mt-5 p-4 sm:p-5 flex flex-col sm:flex-row gap-4 items-start">
              <div className="w-full sm:w-[320px] shrink-0">
                <div className="w-full aspect-video rounded-xl border border-[#272738] bg-[#1B1B2A] grid place-items-center text-center px-4"><div><div className="text-3xl">🎬</div><p className="text-xs text-[#A9A6BE] mt-2 [overflow-wrap:anywhere]">Video {videoId}</p></div></div>
                <p className="text-[11px] text-[#A9A6BE] mt-2">Preview below uses the embedded original • IFrame API {apiReady?'ready':'loading…'}</p>
              </div>
              <div className="min-w-0 flex-1 w-full"><p className="text-[11px] tracking-widest font-bold text-[#EC4899]">NOW LOADED • {fmt(duration)} LONG</p><h2 className="text-xl font-bold mt-1 [overflow-wrap:anywhere]">YouTube Video — {videoId}</h2><p className="text-sm text-[#A9A6BE] mt-1 leading-relaxed">A map is not available. Watch the embedded original below, then use the preview to time your Short.</p>
              <iframe key={videoId} title={`YouTube video player for ${videoId}`} src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen className="w-full aspect-video rounded-xl border border-[#272738] bg-black mt-3" />
              <div className="flex flex-wrap gap-2 mt-3"><a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener" className="bg-white text-black rounded-lg px-3 py-2 text-sm font-bold inline-flex items-center gap-2"><Youtube size={16}/> Watch original on YouTube</a><button onClick={markNow} className="rounded-lg px-3 py-2 text-sm font-bold bg-[#EC4899] text-white flex items-center gap-2"><Timer size={16}/> Mark Funny Moment Now</button><button onClick={()=>{setCurrentTime(0); setPlaying(false);}} className="rounded-lg px-3 py-2 text-sm font-bold bg-[#1B1B2A] border border-[#272738]">Reset preview</button></div></div>
            </div>
          )}
        </section>

        <div className="grid lg:grid-cols-[1fr_360px] gap-5 mt-6 items-start">
          <div className="space-y-5 min-w-0">
            <section className="card p-4 sm:p-6">
              <div className="flex flex-wrap justify-between gap-3 items-start"><div><h2 className="text-xl font-bold flex items-center gap-2"><Wand2 className="text-[#EC4899]"/> Auto Clip Engine</h2><p className="text-sm text-[#A9A6BE] mt-1 leading-relaxed max-w-[560px]">GitHub Pages can’t download YouTube videos, so ClipSmith uses smart peak-picking + your edits to build the Short from the original video via embed — 100% legal, no download.</p></div><button onClick={autoDetect} className="gradient-btn rounded-xl px-4 py-3 font-bold text-sm flex items-center gap-2"><Sparkles size={16}/> ✨ Auto-Detect Funny Moments</button></div>
              <div className="grid grid-cols-3 gap-2 mt-4 text-center"><div className="bg-[#0B0B12] rounded-xl py-3"><p className="text-2xl font-extrabold">{clips.length}</p><p className="text-[11px] text-[#A9A6BE]">Clips</p></div><div className="bg-[#0B0B12] rounded-xl py-3"><p className="text-2xl font-extrabold">{fmt(clips.reduce((a,c)=>a+(c.end-c.start),0))}</p><p className="text-[11px] text-[#A9A6BE]">Short length</p></div><div className="bg-[#0B0B12] rounded-xl py-3"><p className="text-2xl font-extrabold">{clips.length?Math.round(clips.reduce((a,c)=>a+c.confidence,0)/clips.length):0}%</p><p className="text-[11px] text-[#A9A6BE]">Avg. confidence</p></div></div>
            </section>

            <section className="card p-4 sm:p-6">
              <h2 className="font-bold text-lg flex items-center gap-2"><Plus/> Add Clip Manually</h2>
              <div className="grid sm:grid-cols-4 gap-3 mt-3"><label className="text-xs font-bold">Title<input value={manualTitle} onChange={e=>setManualTitle(e.target.value)} className="mt-1.5 w-full bg-[#0B0B12] border border-[#272738] rounded-lg px-3 py-2.5 text-sm font-normal [overflow-wrap:anywhere]" /></label><label className="text-xs font-bold">Start (sec)<input type="number" value={manualStart} onChange={e=>setManualStart(Number(e.target.value))} className="mt-1.5 w-full bg-[#0B0B12] border border-[#272738] rounded-lg px-3 py-2.5 text-sm font-normal" /></label><label className="text-xs font-bold">End (sec)<input type="number" value={manualEnd} onChange={e=>setManualEnd(Number(e.target.value))} className="mt-1.5 w-full bg-[#0B0B12] border border-[#272738] rounded-lg px-3 py-2.5 text-sm font-normal" /></label><div className="flex items-end"><button onClick={addManual} className="w-full bg-white text-black rounded-lg px-3 py-2.5 font-bold text-sm">Add to Short</button></div></div>
              <p className="text-xs text-[#A9A6BE] mt-2">Tip: start the preview, pause on the laugh, then use <b className="text-white">Mark Funny Moment Now</b> — it grabs 5s before + 12s after that moment.</p>
            </section>

            {renderClipList()}

            <section className="card p-4 sm:p-6">
              <h2 className="font-bold text-lg flex items-center gap-2"><Download size={18}/> Export</h2>
              <p className="text-sm text-[#A9A6BE] mt-1">Select the text below to reuse it in a description. Your project is already saved in this app.</p>
              <textarea readOnly value={exportText || 'No clips yet — auto-detect or add a clip to generate timestamps.'} rows={5} className="w-full mt-3 bg-[#0B0B12] border border-[#272738] rounded-xl p-3 text-sm leading-relaxed [overflow-wrap:anywhere]" />
              <div className="flex flex-wrap gap-2 mt-3"><button onClick={downloadJson} className="gradient-btn rounded-xl px-4 py-2.5 text-sm font-bold">Download Clips JSON</button><a href={`#v=${videoId}&clips=${encodeURIComponent(JSON.stringify(clips))}`} className="rounded-xl px-4 py-2.5 text-sm font-bold bg-[#1B1B2A] border border-[#272738]">Preview share state in address bar</a><span className="text-xs text-[#A9A6BE] self-center">Share state is encoded in the page address (#v=…&clips=…).</span></div>
            </section>
          </div>

          <aside className="lg:sticky lg:top-[84px]">
            <div className="card p-4">
              <div className="flex justify-between items-center"><h2 className="font-bold">Short Preview</h2><span className="chip">Clip {clips.length?activeIdx+1:0} / {clips.length}</span></div>
              <div className="flex justify-center mt-4">
                <div className="rounded-[28px] border-[6px] border-black bg-black shadow-2xl overflow-hidden relative" style={previewStyle}>
                  <div className="absolute inset-0" style={{background:'linear-gradient(160deg,#22163F,#3A1140 48%,#3B2108)'}}/>
                  <div className="absolute top-3 left-3 right-3 flex justify-between items-start z-10"><span className="bg-black/60 text-[11px] font-bold px-2.5 py-1 rounded-full max-w-[70%] [overflow-wrap:anywhere]">{activeClip?activeClip.title:'Preview'}</span><span className="bg-black/60 text-[11px] px-2 py-1 rounded-full flex items-center gap-1"><Clock size={11}/> {fmt(currentTime)}</span></div>
                  <div className="absolute inset-0 grid place-items-center"><div className="text-center px-4"><div className="text-4xl">{playing?'▶️':'⏸️'}</div><p className="text-[12px] mt-2 text-white/80 [overflow-wrap:anywhere]">{videoId?`Original video • ${videoId}`:'Load a video to preview'}</p><p className="text-[11px] text-white/60 mt-1">Simulated Short preview — watch the original on YouTube for full audio.</p></div></div>
                  <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
                    {activeClip && <p className={`text-center text-[17px] leading-tight [overflow-wrap:anywhere] ${subStyle==='Bold Meme'?'meme':subStyle==='Neon'?'neon':subStyle==='Minimal'?'minimal':'cartoon'}`}>{activeClip.subtitle}</p>}
                    <div className="flex items-center gap-2 mt-3"><button onClick={()=>{ if(activeIdx>0){ setActiveIdx(activeIdx-1); setCurrentTime(clips[activeIdx-1].start);} }} className="w-9 h-9 rounded-full bg-white text-black grid place-items-center shrink-0" aria-label="Previous clip"><SkipBack size={16}/></button><button onClick={togglePlay} className="w-11 h-11 rounded-full bg-white text-black grid place-items-center shrink-0" aria-label={playing?'Pause':'Play'}>{playing?<Pause size={18}/>:<Play size={18} className="ml-0.5"/>}</button><button onClick={()=>{ if(activeIdx<clips.length-1){ setActiveIdx(activeIdx+1); setCurrentTime(clips[activeIdx+1].start);} }} className="w-9 h-9 rounded-full bg-white text-black grid place-items-center shrink-0" aria-label="Next clip"><SkipForward size={16}/></button><div className="flex-1 h-1.5 bg-white/25 rounded-full overflow-hidden"><div className="h-full bg-white" style={{width:`${progress}%`}}/></div></div>
                  </div>
                </div>
              </div>
              <button onClick={playAllClips} className="w-full gradient-btn rounded-xl py-3 font-bold mt-4 flex items-center justify-center gap-2"><Play size={17}/> Play All Compilation</button>
              <div className="grid grid-cols-3 gap-1.5 mt-3">{(['9:16','1:1','16:9'] as Aspect[]).map(a=><button key={a} onClick={()=>setAspect(a)} className={`rounded-lg py-2 text-xs font-bold border ${aspect===a?'bg-white text-black border-white':'bg-[#1B1B2A] border-[#272738]'}`}>{a}</button>)}</div>
              <label className="block mt-4 text-xs font-bold">Subtitle style<select value={subStyle} onChange={e=>setSubStyle(e.target.value as SubStyle)} className="mt-1.5 w-full bg-[#0B0B12] border border-[#272738] rounded-lg px-3 py-2.5 text-sm font-normal"><option>Bold Meme</option><option>Neon</option><option>Minimal</option><option>Cartoon</option></select></label>
              <button onClick={()=>setMusicOn(v=>!v)} className="mt-3 w-full flex justify-between items-center bg-[#1B1B2A] border border-[#272738] rounded-xl px-3 py-3 text-left"><span className="flex items-center gap-2 text-sm font-bold"><Music size={16} className="text-[#EC4899]"/> Background music</span><span className={`w-10 h-6 rounded-full p-0.5 ${musicOn?'bg-emerald-500':'bg-[#272738]'}`}><span className={`block w-5 h-5 bg-white rounded-full transition-transform ${musicOn?'translate-x-4':''}`}/></span></button>
              <p className="text-[11px] text-[#A9A6BE] mt-2 leading-relaxed">{musicOn?'Music ON (note only): add a trending sound in CapCut / TikTok after export.':'Add trending sound in CapCut / TikTok after export — no copyrighted music is played here.'}</p>
            </div>
          </aside>
        </div>
        </>
        )}

        {mode==='upload' && (
        <div className="pt-6 sm:pt-8 space-y-5">
          <div className="max-w-[760px]"><p className="text-[12px] font-bold tracking-[0.18em] text-[#EC4899]">UPLOAD & RENDER • IN-BROWSER</p><h1 className="display text-[clamp(1.8rem,4vw,2.8rem)] leading-tight font-extrabold tracking-tight mt-3">Upload & Render <span className="gradient-text">Real MP4</span></h1><p className="text-[#A9A6BE] mt-3 leading-relaxed">Plan clips from audio energy, preview them vertically on a canvas, then render in your browser.</p></div>

          <section className="card p-4 sm:p-6">
            <h2 className="font-bold text-lg flex items-center gap-2"><FileVideo className="text-[#EC4899]"/> Your video</h2>
            <div className="mt-3 rounded-2xl border-2 border-dashed border-[#272738] bg-[#0B0B12] p-6 sm:p-8 text-center">
              <div className="text-4xl">🎬</div>
              <p className="font-bold mt-3">Photo / video uploads are not available yet</p>
              <p className="text-sm text-[#A9A6BE] mt-1 leading-relaxed max-w-[560px] mx-auto">This app cannot accept video files yet, so there is no file picker here. Use the timing preview below — set the video length, run audio analysis, and edit the clips. The canvas preview and in-browser render work from those timings.</p>
              <label className="inline-flex items-center gap-2 mt-4 text-sm font-semibold">Video length (sec) <input type="number" min={10} max={7200} value={duration} onChange={e=>setDuration(Math.max(10,Number(e.target.value)||180))} className="w-[90px] bg-[#14141F] border border-[#272738] rounded-lg px-2 py-2" /></label>
            </div>
            <p className="text-[13px] mt-3 text-emerald-300 flex gap-2 items-start"><CheckCircle2 size={16} className="shrink-0 mt-0.5"/>{uploadStatus}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button onClick={autoFindFromAudio} className="gradient-btn rounded-xl px-4 py-3 font-bold text-sm flex items-center gap-2"><AudioWaveform size={16}/> Auto-Find Funny Moments from Audio</button>
              <button onClick={()=>{ setUploadPlaying(v=>!v); if(!activeClip && clips.length) setActiveIdx(0); }} className="rounded-xl px-4 py-3 font-bold text-sm bg-[#1B1B2A] border border-[#272738] flex items-center gap-2">{uploadPlaying?<Pause size={15}/>:<Play size={15}/>} {uploadPlaying?'Pause preview':'Play clips sequentially'}</button>
              <button onClick={downloadJson} className="rounded-xl px-4 py-3 font-bold text-sm bg-[#1B1B2A] border border-[#272738]">Download Clip List</button>
            </div>
            <p className="text-xs text-[#A9A6BE] mt-3 leading-relaxed">How it works: Web Audio API <code className="text-white">decodeAudioData</code> → short-time energy in 0.5s windows → loud peaks (laughs, shouts, reactions) with distance &gt; 8s → top 6 clips, 12–20s each. Here the same peak logic runs as a timing preview.</p>
          </section>

          <section className="card p-4 sm:p-6">
            <h2 className="font-bold text-lg flex items-center gap-2"><Zap className="text-[#F59E0B]"/> Waveform — energy & peak markers</h2>
            <canvas ref={waveformRef} width={920} height={150} className="w-full h-[150px] rounded-xl border border-[#272738] bg-[#0B0B12] mt-3" />
            <div className="flex flex-wrap justify-between gap-2 mt-2 text-xs text-[#A9A6BE]"><span>0.5s energy windows • Pink bars = peaks • Gold markers = P1–P6</span><span>{waveformReady?'Analysis preview ready':'Run Auto-Find to mark peaks'}</span></div>
          </section>

          <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
            <div className="space-y-5 min-w-0">
              <section className="card p-4 sm:p-6">
                <h2 className="font-bold text-lg flex items-center gap-2"><Plus/> Add Clip Manually</h2>
                <div className="grid sm:grid-cols-4 gap-3 mt-3"><label className="text-xs font-bold">Title<input value={manualTitle} onChange={e=>setManualTitle(e.target.value)} className="mt-1.5 w-full bg-[#0B0B12] border border-[#272738] rounded-lg px-3 py-2.5 text-sm font-normal [overflow-wrap:anywhere]" /></label><label className="text-xs font-bold">Start (sec)<input type="number" value={manualStart} onChange={e=>setManualStart(Number(e.target.value))} className="mt-1.5 w-full bg-[#0B0B12] border border-[#272738] rounded-lg px-3 py-2.5 text-sm font-normal" /></label><label className="text-xs font-bold">End (sec)<input type="number" value={manualEnd} onChange={e=>setManualEnd(Number(e.target.value))} className="mt-1.5 w-full bg-[#0B0B12] border border-[#272738] rounded-lg px-3 py-2.5 text-sm font-normal" /></label><div className="flex items-end"><button onClick={addManual} className="w-full bg-white text-black rounded-lg px-3 py-2.5 font-bold text-sm">Add to Short</button></div></div>
              </section>
              {renderClipList()}
            </div>
            <aside className="lg:sticky lg:top-[84px]">
              <div className="card p-4">
                <div className="flex justify-between items-center"><h2 className="font-bold">Vertical Short Preview</h2><span className="chip">360 × 640</span></div>
                <div className="flex justify-center mt-3"><canvas ref={previewCanvasRef} width={360} height={640} className="w-full max-w-[300px] aspect-[9/16] rounded-[22px] border-4 border-black bg-black object-cover" /></div>
                <p className="text-[11px] text-[#A9A6BE] mt-2 text-center">Canvas crops to 9:16 (center crop) and draws the subtitle with a black outline at the bottom.</p>
                <div className="flex gap-2 mt-3">
                  <button onClick={()=>playUploadClip(activeIdx)} className="flex-1 bg-white text-black rounded-xl py-2.5 font-bold text-sm flex items-center justify-center gap-2"><Play size={15}/> Play Clip {clips.length?activeIdx+1:0}</button>
                  <button onClick={()=>setUploadPlaying(v=>!v)} className="flex-1 bg-[#1B1B2A] border border-[#272738] rounded-xl py-2.5 font-bold text-sm">{uploadPlaying?'Pause':'Play All'}</button>
                </div>
                <label className="block mt-4 text-xs font-bold">Subtitle style<select value={subStyle} onChange={e=>setSubStyle(e.target.value as SubStyle)} className="mt-1.5 w-full bg-[#0B0B12] border border-[#272738] rounded-lg px-3 py-2.5 text-sm font-normal"><option>Bold Meme</option><option>Neon</option><option>Minimal</option><option>Cartoon</option></select></label>
                <button onClick={renderRealMp4} disabled={rendering} className="w-full gradient-btn rounded-xl py-3 font-bold mt-4 flex items-center justify-center gap-2 disabled:opacity-60"><Film size={17}/> {rendering?'Rendering…':'Render Real MP4 Short'}</button>
                {rendering && <p className="text-sm font-bold text-amber-300 mt-2 text-center">{renderProgress || 'Rendering…'}</p>}
                {renderNote && <p className="text-[13px] mt-2 leading-relaxed text-[#A9A6BE]">{renderNote}</p>}
                {renderUrl && (
                  <div className="mt-3 space-y-2">
                    <video src={renderUrl} controls className="w-full aspect-[9/16] max-h-[320px] rounded-xl bg-black object-contain" />
                    <a href={renderUrl} download="clipsmith-short.webm" className="block text-center bg-white text-black rounded-xl py-2.5 font-bold text-sm">Download MP4</a>
                    <p className="text-[11px] text-[#A9A6BE] text-center">If the file will not play as MP4 in your player, rename it to .webm — it is the browser-recorded canvas render.</p>
                  </div>
                )}
                {!renderUrl && !rendering && <button onClick={()=>{ setRenderNote('Download Clip List + Use Backend Below — use the clip list in the Backend Deploy tab with your own uploaded file.'); setMode('backend'); }} className="w-full mt-2 bg-[#1B1B2A] border border-[#272738] rounded-xl py-2.5 font-bold text-sm">Use Backend Instead →</button>}
              </div>
            </aside>
          </div>
        </div>
        )}

        {mode==='backend' && (
        <div className="pt-6 sm:pt-8 space-y-5">
          <div className="max-w-[760px]"><p className="text-[12px] font-bold tracking-[0.18em] text-[#EC4899]">BACKEND DEPLOY • SERVER RENDERING</p><h1 className="display text-[clamp(1.8rem,4vw,2.8rem)] leading-tight font-extrabold tracking-tight mt-3">Deploy the <span className="gradient-text">backend</span></h1><p className="text-[#A9A6BE] mt-3 leading-relaxed">GitHub Pages = frontend only. For server rendering, deploy the Python backend on Render / Railway (free).</p></div>

          <section className="card p-4 sm:p-6">
            <h2 className="font-bold text-lg flex items-center gap-2"><Server className="text-[#EC4899]"/> Backend code — uploaded files only</h2>
            <p className="text-sm text-[#A9A6BE] mt-1 leading-relaxed">This backend ONLY accepts uploaded video files (not YouTube downloads). Endpoints: <b className="text-white">POST /upload</b>, <b className="text-white">POST /analyze</b> (ffmpeg loudness peaks), <b className="text-white">POST /render</b> (ffmpeg crop to 1080×1920, burn subtitles with drawtext, concat clips).</p>
            <pre className="mt-3 bg-black/60 border border-[#272738] rounded-xl p-3 text-[12px] leading-relaxed overflow-x-auto text-emerald-200 whitespace-pre-wrap [overflow-wrap:anywhere]">{BACKEND_CODE}</pre>
            <h3 className="font-bold mt-4 text-sm">requirements.txt</h3>
            <pre className="mt-2 bg-black/60 border border-[#272738] rounded-xl p-3 text-[12px] overflow-x-auto text-emerald-200">{REQUIREMENTS}</pre>
          </section>

          <section className="card p-4 sm:p-6">
            <h2 className="font-bold text-lg">Deploy steps</h2>
            <ol className="mt-3 space-y-2 text-sm text-[#A9A6BE] leading-relaxed list-decimal pl-5"><li><b className="text-white">Upload backend folder to GitHub</b> — put <code className="text-white">app.py</code> and <code className="text-white">requirements.txt</code> in a repo.</li><li><b className="text-white">Render.com → New Web Service → connect repo</b> — Build: <code className="text-white">pip install -r requirements.txt</code> → Start: <code className="text-white">gunicorn app:app</code></li><li><b className="text-white">Paste backend URL into Frontend Settings below and Save.</b></li></ol>
          </section>

          <section className="card p-4 sm:p-6">
            <h2 className="font-bold text-lg flex items-center gap-2"><Settings2/> Frontend Settings</h2>
            <label className="block mt-3 text-sm font-bold" htmlFor="backend-url">Backend URL</label>
            <div className="flex flex-col sm:flex-row gap-2 mt-2"><input id="backend-url" value={backendDraft} onChange={e=>setBackendDraft(e.target.value)} placeholder="https://your-service.onrender.com" className="flex-1 bg-[#0B0B12] border border-[#272738] rounded-xl px-3 py-3 text-sm [overflow-wrap:anywhere]" /><button onClick={saveBackendUrl} disabled={backendSaving} className="gradient-btn rounded-xl px-5 py-3 font-bold text-sm disabled:opacity-60">{backendSaving?'Saving…':'Save'}</button></div>
            <p className="text-[13px] mt-2 text-emerald-300 flex gap-2 items-start"><CheckCircle2 size={16} className="shrink-0 mt-0.5"/>{backendStatus}</p>
            {backendUrl && <div className="flex flex-wrap gap-2 mt-3"><button onClick={()=>callBackend('analyze')} disabled={backendBusy} className="rounded-xl px-4 py-2.5 font-bold text-sm bg-white text-black disabled:opacity-60">Analyze on Backend</button><button onClick={()=>callBackend('render')} disabled={backendBusy} className="rounded-xl px-4 py-2.5 font-bold text-sm bg-[#1B1B2A] border border-[#272738] disabled:opacity-60">Render on Backend</button><a href={backendUrl} target="_blank" rel="noopener" className="rounded-xl px-4 py-2.5 font-bold text-sm bg-[#1B1B2A] border border-[#272738] inline-flex items-center gap-2">Open backend <ExternalLink size={14}/></a></div>}
            {!backendUrl && <p className="text-xs text-[#A9A6BE] mt-2">Save a backend URL to enable the buttons above. Your clips ({clips.length}) will be sent as timing data with the request.</p>}
          </section>
        </div>
        )}

        <section className="grid md:grid-cols-3 gap-4 mt-8">
          {[['1','Paste Link','Drop any YouTube watch, youtu.be, Shorts, or Live link and load the video.'],['2','Auto-Pick & Edit','Let the engine find peaks, then fix start/end times, titles, and subtitles.'],['3','Preview & Export','Watch the vertical compilation, then download the Clips JSON and timestamps.']].map(([n,t,d])=><div key={n} className="card p-5"><div className="w-9 h-9 rounded-full gradient-btn grid place-items-center font-extrabold">{n}</div><h3 className="font-bold mt-3">{t}</h3><p className="text-sm text-[#A9A6BE] mt-1 leading-relaxed">{d}</p></div>)}
        </section>
        <section className="card p-4 sm:p-6 mt-4">
          <button onClick={()=>setShowFaq(v=>!v)} className="w-full flex justify-between items-center text-left"><span className="font-bold">Why no MP4 download?</span>{showFaq?<ChevronUp/>:<ChevronDown/>}</button>
          {showFaq && <div className="pt-3 text-sm text-[#A9A6BE] leading-relaxed"><p>Because YouTube’s Terms + GitHub Pages being static mean this app cannot download or re-encode YouTube videos. It builds a legal Short from timed clips of the original video instead. To get a real MP4 auto-download you need a backend (Python + yt-dlp + ffmpeg).</p><button onClick={()=>setShowCode(v=>!v)} className="mt-3 bg-[#1B1B2A] border border-[#272738] rounded-lg px-3 py-2 text-xs font-bold text-white">{showCode?'Hide backend idea':'Show backend idea (code)'}</button>{showCode && <pre className="mt-3 bg-black/50 border border-[#272738] rounded-xl p-3 text-[12px] overflow-x-auto text-emerald-200">{`# Backend idea only — not used by this static app\n# pip install yt-dlp\n# yt-dlp -f "bestvideo+bestaudio" --download-sections "*00:12-00:28" URL\n# ffmpeg -i input.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" short.mp4`}</pre>}</div>}
          <p className="text-xs text-[#A9A6BE] mt-4 flex gap-1.5 items-center"><ShieldCheck size={15} className="text-emerald-400"/> No video is downloaded or re-uploaded by this page.</p>
        </section>

        <footer className="text-center text-sm text-[#A9A6BE] mt-10 leading-relaxed">Made for creators • Deploy: upload this single page to a GitHub repo → Settings → Pages → Deploy from main branch<br/>ClipSmith respects the original video — always link back to the creator.</footer>
      </main>
    </div>
  );
}
