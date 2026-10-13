import { useState, useRef, useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { createBrowserRouter, RouterProvider, NavLink, Link, Outlet, useLocation } from "react-router";
import { Button } from "./components/ui/button";
import { BEFORE_US } from "./config";
import PublicHome, { PublicInformation } from "./PublicHome";
import MemberToday, { TodayDemo } from "./MemberToday";
import ApplicationForm from "./ApplicationForm";
import MemberProfile, { MemberSupport } from "./MemberProfile";
import { PhotoDemo } from "./PhotoStep";
import AdminDemo from "./AdminDemo";
import { AdminDashboard, AdminLayout, AdminList } from "./AdminConsole";
import { AdminGovernance } from "./AdminGovernance";
import { AdminOperations } from "./AdminOperations";
import MemberPayments, { PaymentDemo } from "./PaymentFlow";
import MemberIntroduction, { IntroductionDemo } from "./IntroductionFlow";
import { NoonDemo } from "./NoonStatus";
import { AgreementDemo, MemberAgreement, MemberMeeting } from "./AgreementFlow";
import { LetterDemo } from "./LetterDemo";
import { SceneDemo } from "./SceneDemo";
import { MeetingDemo } from "./MeetingDemo";
import { ConductDemo } from "./ConductPolicy";
import {
  Search, Bell, ChevronLeft, ChevronRight, Plus, Share2,
  Calendar, BookOpen, User, Home, ExternalLink, Star,
  Filter, ArrowRight, Music, Ticket, Trophy, MapPin,
  Clock, X, Sun, Moon, Settings, Eye, Check, Pencil,
  Users, Sparkles, Play, BarChart3, Heart, MessageCircle,
  Download, ImageIcon, Tag, Layers, ChevronDown, Flame, Menu, LogOut,
} from "lucide-react";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Page = "landing" | "onboarding" | "home" | "calendar" | "diary" | "my" | "community";
type ArtistId = "svt" | "ive" | "njz" | "hades" | "cats" | "wicked" | "rib" | "espa";
type Category = "뮤지컬" | "콘서트" | "페스티벌" | "연극" | "클래식" | "팬미팅" | "K-pop";
type CalThemeId = "default" | "pastel" | "dark" | "minimal" | "artist";

// ─── ARTIST DATA ──────────────────────────────────────────────────────────────

const ARTISTS: { id: ArtistId; name: string; short: string; category: Category; from: string; to: string; dot: string }[] = [
  { id: "svt",    name: "세븐틴",    short: "SVT",   category: "K-pop",   from: "#8B5CF6", to: "#EC4899", dot: "#A855F7" },
  { id: "ive",    name: "아이브",    short: "IVE",   category: "K-pop",   from: "#F43F5E", to: "#FB923C", dot: "#F43F5E" },
  { id: "njz",    name: "뉴진스",    short: "NJZ",   category: "K-pop",   from: "#3B82F6", to: "#06B6D4", dot: "#3B82F6" },
  { id: "hades",  name: "하데스타운", short: "HADES", category: "뮤지컬",  from: "#2D1B69", to: "#7C3AED", dot: "#7C3AED" },
  { id: "cats",   name: "캣츠",      short: "CATS",  category: "뮤지컬",  from: "#92400E", to: "#D97706", dot: "#F59E0B" },
  { id: "wicked", name: "위키드",    short: "WKD",   category: "뮤지컬",  from: "#064E3B", to: "#6D28D9", dot: "#10B981" },
  { id: "rib",    name: "록인부산",   short: "RIB",   category: "페스티벌", from: "#B45309", to: "#EF4444", dot: "#F97316" },
  { id: "espa",   name: "에스파",    short: "ae",    category: "K-pop",   from: "#1C1C2E", to: "#4A4A7A", dot: "#6366F1" },
];

const ALL_CATEGORIES: Category[] = ["뮤지컬", "콘서트", "페스티벌", "연극", "클래식", "팬미팅", "K-pop"];

const EVENTS: { date: number; artistId: ArtistId; category: Category; title: string; time?: string; venue?: string; hasTicket?: boolean }[] = [
  { date: 5,  artistId: "hades", category: "뮤지컬",  title: "하데스타운 정규공연",            time: "19:30", venue: "블루스퀘어" },
  { date: 8,  artistId: "njz",   category: "K-pop",   title: "뉴진스 팬미팅 서울",             time: "18:00", venue: "올림픽홀" },
  { date: 10, artistId: "cats",  category: "뮤지컬",  title: "캣츠 갈라콘서트",               time: "19:00", venue: "샤롯데씨어터" },
  { date: 11, artistId: "svt",   category: "콘서트",  title: "SEVENTEEN WORLD TOUR 서울 선예매", time: "20:00", venue: "고척스카이돔", hasTicket: true },
  { date: 15, artistId: "svt",   category: "K-pop",   title: "SVT 13th 미니앨범 컴백",         time: "18:00" },
  { date: 15, artistId: "ive",   category: "콘서트",  title: "IVE 팬콘서트",                   time: "19:00", venue: "KSPO DOME" },
  { date: 16, artistId: "wicked",category: "뮤지컬",  title: "위키드 신시즌 오프닝",            time: "19:30", venue: "예술의전당" },
  { date: 18, artistId: "rib",   category: "페스티벌", title: "록인부산 Day1",                  time: "14:00", venue: "아시아드주경기장" },
  { date: 19, artistId: "rib",   category: "페스티벌", title: "록인부산 Day2",                  time: "14:00", venue: "아시아드주경기장" },
  { date: 22, artistId: "svt",   category: "팬미팅",  title: "SVT 팬미팅",                     time: "19:00", venue: "KSPO DOME" },
  { date: 22, artistId: "hades", category: "뮤지컬",  title: "하데스타운 특별공연",             time: "14:00", venue: "블루스퀘어" },
  { date: 23, artistId: "njz",   category: "콘서트",  title: "뉴진스 쇼케이스",                time: "20:00", venue: "올림픽홀" },
  { date: 24, artistId: "cats",  category: "뮤지컬",  title: "캣츠 마틴네",                    time: "15:00", venue: "샤롯데씨어터" },
  { date: 25, artistId: "svt",   category: "콘서트",  title: "SVT 서울 콘서트 Day2",           time: "18:00", venue: "고척스카이돔", hasTicket: true },
  { date: 27, artistId: "wicked",category: "뮤지컬",  title: "위키드 수요 마틴네",              time: "14:00", venue: "예술의전당" },
  { date: 31, artistId: "hades", category: "뮤지컬",  title: "하데스타운 마지막 공연",          time: "19:30", venue: "블루스퀘어" },
];

const TICKETING_SOON = [
  { date: "07.25", artistId: "svt" as ArtistId,   title: "SEVENTEEN WORLD TOUR 서울 2차 예매", site: "인터파크" },
  { date: "07.28", artistId: "ive" as ArtistId,   title: "IVE FAN CONCERT 선예매",             site: "멜론티켓" },
  { date: "08.02", artistId: "hades" as ArtistId, title: "하데스타운 시즌2 선예매",              site: "YES24" },
];

const DIARY_ENTRIES = [
  { id: 1, artistId: "hades" as ArtistId, category: "뮤지컬" as Category, title: "하데스타운 — 8월 정규공연", date: "2026. 08. 05", cast: "에우리디케: 박지연 / 하데스: 김준현", seat: "2층 E열 12번", venue: "블루스퀘어 마스터홀", memo: "눈물 줄줄... 2막 'Wait For Me' 다시 무너졌다. 반드시 다시 본다.", amount: 154000, rating: 5, companion: "혼자" },
  { id: 2, artistId: "svt" as ArtistId,   category: "콘서트" as Category, title: "SEVENTEEN WORLD TOUR 서울 Day1", date: "2026. 07. 25", cast: "", seat: "1층 GA", venue: "고척스카이돔", memo: "인생 최고의 날. 다음 콘서트도 무조건 간다 😭", amount: 132000, rating: 5, companion: "친구 2명" },
  { id: 3, artistId: "ive" as ArtistId,   category: "팬미팅" as Category, title: "아이브 팬콘서트 2026", date: "2026. 07. 15", cast: "", seat: "2층 A구역", venue: "KSPO DOME", memo: "포카 처에 들 때까지 6장 언박싱, 결국 성공!", amount: 96000, rating: 4, companion: "혼자" },
];

// Calendar themes
const CAL_THEMES: Record<CalThemeId, { name: string; label: string; preview: string; todayGrad: string; dot: string | null }> = {
  default: { name: "기본",    label: "보라+파랑",   preview: "linear-gradient(135deg,#6C4CE0,#3B82F6)", todayGrad: "linear-gradient(135deg,#6C4CE0,#3B82F6)", dot: null },
  pastel:  { name: "파스텔",  label: "핑크+민트",   preview: "linear-gradient(135deg,#F472B6,#A7F3D0)", todayGrad: "linear-gradient(135deg,#F472B6,#86EFAC)", dot: "#F9A8D4" },
  dark:    { name: "다크",    label: "딥 퍼플",    preview: "linear-gradient(135deg,#312E81,#1E3A5F)", todayGrad: "linear-gradient(135deg,#A78BFA,#60A5FA)", dot: "#A78BFA" },
  minimal: { name: "미니멀",  label: "모노크롬",   preview: "linear-gradient(135deg,#374151,#9CA3AF)", todayGrad: "linear-gradient(135deg,#374151,#6B7280)", dot: "#9CA3AF" },
  artist:  { name: "아티스트", label: "최애 테마",  preview: "linear-gradient(135deg,#8B5CF6,#EC4899)", todayGrad: "linear-gradient(135deg,#8B5CF6,#EC4899)", dot: null },
};

// Community data
const COMMUNITY_ROOMS = [
  { id: "hades", artistId: "hades" as ArtistId, title: "하데스타운", sub: "블루스퀘어 마스터홀",  members: 4821, posts: 234, records: 89,  tags: ["캐스팅잡담","시야후기","동행"], joined: true },
  { id: "svt",   artistId: "svt" as ArtistId,   title: "SVT 월드투어 서울", sub: "고척스카이돔",  members: 12453, posts: 891, records: 412, tags: ["스포주의","동행","좌석시야"], joined: true },
  { id: "ive",   artistId: "ive" as ArtistId,   title: "아이브 팬콘서트", sub: "KSPO DOME",      members: 6302, posts: 445, records: 178, tags: ["시야후기","캐스팅"], joined: false },
  { id: "wicked",artistId: "wicked" as ArtistId,title: "위키드 신시즌",   sub: "예술의전당",      members: 3102, posts: 198, records: 64,  tags: ["캐스팅잡담","초연후기"], joined: false },
  { id: "rib",   artistId: "rib" as ArtistId,   title: "록인부산 2026",  sub: "아시아드주경기장", members: 8901, posts: 672, records: 231, tags: ["라인업","동행","현장후기"], joined: false },
];

const COMMUNITY_POSTS = [
  { id: 1, roomId: "hades", user: "뮤지컬러버", avatar: "🎭", title: "2층 E열 시야 사진 공유해요", body: "생각보다 무대 전체가 잘 보였어요. 오케스트라 피트도 보이고 음향 최고!", tags: ["시야후기"], likes: 47, comments: 12, time: "2시간 전", hasRecord: false },
  { id: 2, roomId: "svt",   user: "캐럿별빛",  avatar: "💜", title: "어제 공연 잊을 수가 없어요", body: "Going Seventeen 파트에서 눈물 터짐... 다음 날도 연속 봤습니다. 관람 기록 공개했어요!", tags: ["스포주의"], likes: 128, comments: 34, time: "5시간 전", hasRecord: true },
  { id: 3, roomId: "hades", user: "하데스덕",  avatar: "⚡", title: "7/22 에우리디케 캐스팅 확인했어요", body: "박지연 배우 나와요! 맑은 음색 좋아하시는 분들께 추천합니다.", tags: ["캐스팅잡담"], likes: 89, comments: 22, time: "어제", hasRecord: false },
  { id: 4, roomId: "ive",   user: "아이브세계", avatar: "🍀", title: "8/1 동행 구해요 (여성 1명)", body: "1층 A구역 S석 여분 있어요. 조용히 즐기실 분!", tags: ["동행"], likes: 12, comments: 8, time: "어제", hasRecord: false },
  { id: 5, roomId: "wicked",user: "오즈의마법사", avatar: "✨", title: "엘파바 교체 캐스팅 후기", body: "아이비 배우에서 허혜진 배우로 교체 회차 봤는데 또 다른 매력이 있네요.", tags: ["캐스팅잡담"], likes: 63, comments: 19, time: "2일 전", hasRecord: true },
];

// Timeline data for My page
const TIMELINE = [
  { year: 2024, items: [
    { month: 3, artistId: "svt" as ArtistId, title: "SVT 팬미팅", note: "첫 공연", isFirst: true },
  ]},
  { year: 2025, items: [
    { month: 1, artistId: "hades" as ArtistId, title: "하데스타운 초연", note: "" },
    { month: 9, artistId: "ive" as ArtistId,   title: "아이브 팬콘서트", note: "" },
  ]},
  { year: 2026, items: [
    { month: 7, artistId: "svt" as ArtistId,   title: "SVT 월드투어 서울", note: "" },
    { month: 8, artistId: "hades" as ArtistId, title: "하데스타운 시즌2", note: "예정", isUpcoming: true },
  ]},
];

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────

function ArtCover({ artistId, size = "md", className = "" }: { artistId: ArtistId; size?: "xs"|"sm"|"md"|"lg"; className?: string }) {
  const a = ARTISTS.find(x => x.id === artistId)!;
  const sMap = { xs:"w-8 h-8", sm:"w-12 h-12", md:"w-14 h-14", lg:"w-20 h-20" };
  const tMap = { xs:"text-[9px]", sm: a.short.length > 4 ? "text-[9px]" : "text-xs", md: a.short.length > 4 ? "text-[10px]" : "text-sm", lg: a.short.length > 4 ? "text-xs" : "text-lg" };
  return (
    <div className={`${sMap[size]} rounded-xl flex items-center justify-center font-black text-white select-none flex-shrink-0 ${tMap[size]} ${className}`}
      style={{ background: `linear-gradient(145deg,${a.from},${a.to})` }}>
      {a.short}
    </div>
  );
}

function CatBadge({ category }: { category: Category }) {
  const m: Partial<Record<Category, string>> = {
    뮤지컬: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    콘서트: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    페스티벌: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    연극: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
    클래식: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    팬미팅: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
    "K-pop": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  };
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${m[category] ?? "bg-muted text-muted-foreground"}`}>{category}</span>;
}

function DarkToggle({ isDark, toggle }: { isDark: boolean; toggle: () => void }) {
  return (
    <button onClick={toggle}
      className="w-8 h-8 rounded-lg flex items-center justify-center bg-muted hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
      title={isDark ? "라이트 모드" : "다크 모드"}>
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

function PrimaryBtn({ children, onClick, className = "", small = false }: { children: React.ReactNode; onClick?: () => void; className?: string; small?: boolean }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 ${small ? "px-4 py-2 text-sm" : "px-6 py-3.5 text-[15px]"} rounded-full text-white font-semibold transition-all hover:opacity-90 hover:-translate-y-0.5 active:scale-[0.98] ${className}`}
      style={{ background: "linear-gradient(135deg,#6C4CE0,#3B82F6)" }}>
      {children}
    </button>
  );
}

// ─── ONBOARDING ───────────────────────────────────────────────────────────────

function LiveCalPreview({ theme, density, startDay }: { theme: CalThemeId; density: "dot"|"title"; startDay: "sun"|"mon" }) {
  const t = CAL_THEMES[theme];
  const first = startDay === "sun" ? 3 : 2; // July 2026
  const DAYS_KR = startDay === "sun" ? ["일","월","화","수","목","금","토"] : ["월","화","수","목","금","토","일"];
  const sampleEvents: Record<number, ArtistId> = { 5:"hades",8:"njz",15:"svt",18:"rib",22:"svt",25:"svt" };
  return (
    <div className="bg-card rounded-2xl border border-border p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-black text-foreground">2026. 07</span>
        <div className="flex gap-1">
          <div className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground"><ChevronLeft size={12} /></div>
          <div className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground"><ChevronRight size={12} /></div>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {DAYS_KR.map((d,i) => (
          <div key={d} className={`text-center text-[9px] font-bold py-0.5 ${startDay==="sun" ? (i===0?"text-red-400":i===6?"text-blue-400":"text-muted-foreground") : (i===5?"text-blue-400":i===6?"text-red-400":"text-muted-foreground")}`}>{d}</div>
        ))}
        {Array.from({ length: first }).map((_,i) => <div key={`e${i}`} />)}
        {Array.from({ length: 31 }).map((_,i) => {
          const d = i+1;
          const isToday = d === 22;
          const isSel = d === 15;
          const ev = sampleEvents[d];
          const dotColor = t.dot ?? (ev ? ARTISTS.find(a => a.id === ev)?.dot ?? "#6C4CE0" : null);
          return (
            <div key={d} className={`flex flex-col items-center py-0.5 rounded-lg ${isSel ? "bg-primary/10" : ""}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${isToday ? "text-white" : "text-foreground"}`}
                style={isToday ? { background: t.todayGrad } : {}}>
                {d}
              </span>
              {density === "dot" && dotColor && ev
                ? <span className="w-1 h-1 rounded-full mt-0.5" style={{ backgroundColor: dotColor }} />
                : density === "title" && ev
                ? <span className="text-[7px] text-muted-foreground leading-tight text-center truncate max-w-[28px]">{ARTISTS.find(a=>a.id===ev)?.short}</span>
                : null
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OnboardingPage({ onComplete, isDark, toggleDark }: { onComplete: () => void; isDark: boolean; toggleDark: () => void }) {
  const [step, setStep] = useState(1);
  const [selCats, setSelCats] = useState<Set<Category>>(new Set());
  const [selArtists, setSelArtists] = useState<Set<ArtistId>>(new Set());
  const [calTheme, setCalTheme] = useState<CalThemeId>("default");
  const [density, setDensity] = useState<"dot"|"title">("dot");
  const [startDay, setStartDay] = useState<"sun"|"mon">("sun");
  const [notifToggles, setNotifToggles] = useState<Record<ArtistId, boolean>>({} as Record<ArtistId, boolean>);

  const totalSteps = 4;
  const progress = (step / (totalSteps + 1)) * 100;

  const toggleCat = (c: Category) => { const n = new Set(selCats); n.has(c) ? n.delete(c) : n.add(c); setSelCats(n); };
  const toggleArtist = (id: ArtistId) => { const n = new Set(selArtists); n.has(id) ? n.delete(id) : n.add(id); setSelArtists(n); };
  const toggleNotif = (id: ArtistId) => setNotifToggles(p => ({ ...p, [id]: !p[id] }));

  const canNext = step === 1 ? selCats.size > 0 : step === 2 ? selArtists.size > 0 : true;

  if (step === totalSteps + 1) {
    // Completion screen
    return (
      <div className={`min-h-screen bg-background flex flex-col items-center justify-center px-6 ${isDark ? "dark" : ""}`}
        style={{ fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, type: "spring" }}
          className="text-center max-w-md">
          <div className="text-6xl mb-6">🎉</div>
          <h1 className="text-3xl font-black text-foreground mb-3">
            <span style={{ background:"linear-gradient(135deg,#6C4CE0,#3B82F6)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>나만의 캘린더</span>가<br />완성됐어요!
          </h1>
          <p className="text-muted-foreground text-[15px] mb-8 leading-relaxed">
            {selCats.size}개 카테고리 · {selArtists.size}명의 최애·작품<br />이제 내 공연 캘린더를 마음껏 즐겨보세요.
          </p>
          <div className="flex gap-3 flex-wrap justify-center mb-6">
            {Array.from(selArtists).slice(0,4).map(id => <ArtCover key={id} artistId={id} size="md" />)}
          </div>
          <PrimaryBtn onClick={onComplete}>
            내 캘린더 보러가기 <ArrowRight size={16} />
          </PrimaryBtn>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-background ${isDark ? "dark" : ""}`}
      style={{ fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur-md border-b border-border">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background:"linear-gradient(135deg,#6C4CE0,#3B82F6)" }}>
              <span className="text-white text-[10px] font-black">O</span>
            </div>
            <span className="font-black text-sm text-foreground">오늘핀</span>
          </div>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: "linear-gradient(90deg,#6C4CE0,#3B82F6)" }} />
          </div>
          <span className="text-xs text-muted-foreground font-semibold">{step} / {totalSteps}</span>
          <DarkToggle isDark={isDark} toggle={toggleDark} />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <motion.div key={step} initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }} transition={{ duration:0.3 }}>

          {/* STEP 1: 카테고리 */}
          {step === 1 && (
            <>
              <div className="mb-8">
                <div className="text-xs font-bold text-primary uppercase tracking-wider mb-2">Step 01</div>
                <h2 className="text-2xl font-black text-foreground mb-2">어떤 공연에 관심 있나요?</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  관심 카테고리를 선택해주세요.
                </p>
                <div className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/8 text-primary text-xs font-semibold">
                  <Sparkles size={12} />
                  관심 대상은 무제한으로 등록할 수 있어요 — 타 서비스와 다릅니다
                </div>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {ALL_CATEGORIES.map(cat => (
                  <button key={cat} onClick={() => toggleCat(cat)}
                    className={`p-4 rounded-2xl border-2 transition-all text-sm font-bold flex flex-col items-center gap-2 ${
                      selCats.has(cat) ? "border-primary bg-primary/8 text-primary" : "border-border bg-card text-foreground hover:border-primary/30"
                    }`}>
                    <span className="text-2xl">{{"뮤지컬":"🎭","콘서트":"🎤","페스티벌":"🎪","연극":"🎬","클래식":"🎻","팬미팅":"💜","K-pop":"🌟"}[cat]}</span>
                    {cat}
                    {selCats.has(cat) && <Check size={14} className="text-primary" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* STEP 2: 아티스트 */}
          {step === 2 && (
            <>
              <div className="mb-8">
                <div className="text-xs font-bold text-primary uppercase tracking-wider mb-2">Step 02</div>
                <h2 className="text-2xl font-black text-foreground mb-2">최애·관심 작품을 골라보세요</h2>
                <p className="text-muted-foreground text-sm">여러 명·작품을 동시에 선택할 수 있어요.</p>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
                {ARTISTS.map(art => (
                  <button key={art.id} onClick={() => toggleArtist(art.id)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all ${
                      selArtists.has(art.id) ? "border-primary bg-primary/8" : "border-border bg-card hover:border-primary/30"
                    }`}>
                    <div className="relative">
                      <div className="w-14 h-14 rounded-xl flex items-center justify-center font-black text-white"
                        style={{ background: `linear-gradient(145deg,${art.from},${art.to})`, fontSize: art.short.length > 4 ? "10px" : "13px" }}>
                        {art.short}
                      </div>
                      {selArtists.has(art.id) && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                          <Check size={10} className="text-white" />
                        </div>
                      )}
                    </div>
                    <span className="text-[11px] font-semibold text-foreground text-center leading-tight">{art.name}</span>
                    <span className="text-[9px] text-muted-foreground">{art.category}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* STEP 3: 캘린더 꾸미기 */}
          {step === 3 && (
            <>
              <div className="mb-6">
                <div className="text-xs font-bold text-primary uppercase tracking-wider mb-2">Step 03</div>
                <h2 className="text-2xl font-black text-foreground mb-2">내 캘린더를 꾸며볼까요?</h2>
                <p className="text-muted-foreground text-sm">설정을 바꾸면 오른쪽 미리보기가 실시간으로 업데이트돼요.</p>
              </div>
              <div className="grid grid-cols-[1fr_320px] gap-8">
                {/* Controls */}
                <div className="space-y-6">
                  {/* Theme */}
                  <div>
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-3">색 테마</label>
                    <div className="grid grid-cols-5 gap-2">
                      {(Object.keys(CAL_THEMES) as CalThemeId[]).map(tid => {
                        const th = CAL_THEMES[tid];
                        return (
                          <button key={tid} onClick={() => setCalTheme(tid)}
                            className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1.5 transition-all ${calTheme === tid ? "border-primary bg-primary/8" : "border-border bg-card hover:border-primary/30"}`}>
                            <div className="w-8 h-8 rounded-lg flex-shrink-0" style={{ background: th.preview }} />
                            <span className="text-[9px] font-bold text-foreground text-center">{th.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Density */}
                  <div>
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-3">표시 방식</label>
                    <div className="flex gap-2">
                      {([{v:"dot" as const, label:"점만"},{v:"title" as const, label:"제목 표시"}]).map(({v,label}) => (
                        <button key={v} onClick={() => setDensity(v)}
                          className={`flex-1 py-2.5 rounded-xl border-2 text-xs font-semibold transition-all ${density===v ? "border-primary text-primary bg-primary/8" : "border-border text-muted-foreground hover:border-primary/30"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Start day */}
                  <div>
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-3">시작 요일</label>
                    <div className="flex gap-2">
                      {([{v:"sun" as const, label:"일요일"},{v:"mon" as const, label:"월요일"}]).map(({v,label}) => (
                        <button key={v} onClick={() => setStartDay(v)}
                          className={`flex-1 py-2.5 rounded-xl border-2 text-xs font-semibold transition-all ${startDay===v ? "border-primary text-primary bg-primary/8" : "border-border text-muted-foreground hover:border-primary/30"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {/* Live preview */}
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-center mb-1">실시간 미리보기</div>
                  <LiveCalPreview theme={calTheme} density={density} startDay={startDay} />
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/6 text-primary text-xs font-medium">
                    <Sparkles size={11} />
                    캘린더 메뉴에서 언제든 변경 가능해요
                  </div>
                </div>
              </div>
            </>
          )}

          {/* STEP 4: 알림 설정 */}
          {step === 4 && (
            <>
              <div className="mb-6">
                <div className="text-xs font-bold text-primary uppercase tracking-wider mb-2">Step 04</div>
                <h2 className="text-2xl font-black text-foreground mb-2">알림을 설정해볼까요?</h2>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/8 text-primary text-xs font-semibold inline-flex mb-2">
                  <Bell size={12} /> 스팸 없이 꼭 필요한 알림만 — 원하는 대상·타입별로만 받아요
                </div>
              </div>
              <div className="space-y-3">
                {Array.from(selArtists).slice(0, 4).map(id => {
                  const art = ARTISTS.find(a => a.id === id)!;
                  const enabled = notifToggles[id] !== false;
                  return (
                    <div key={id} className="bg-card rounded-2xl border border-border p-5">
                      <div className="flex items-center gap-3 mb-4">
                        <ArtCover artistId={id} size="sm" />
                        <div>
                          <div className="font-bold text-sm text-foreground">{art.name}</div>
                          <div className="text-[10px] text-muted-foreground">{art.category}</div>
                        </div>
                        <button
                          onClick={() => toggleNotif(id)}
                          className={`ml-auto w-10 h-5 rounded-full transition-all relative ${enabled ? "bg-primary" : "bg-muted"}`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
                        </button>
                      </div>
                      {enabled && (
                        <div className="grid grid-cols-3 gap-2">
                          {[["티켓팅 오픈","2시간 전"],["공연 당일","24시간 전"],["생일·기념일","당일 오전"]].map(([type, timing]) => (
                            <div key={type} className="p-2.5 rounded-xl bg-muted/60 text-center">
                              <div className="text-[10px] font-bold text-foreground mb-0.5">{type}</div>
                              <div className="text-[9px] text-primary font-semibold">{timing}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {selArtists.size === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">선택한 최애·작품이 없어요</div>
                )}
              </div>
            </>
          )}

        </motion.div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-10">
          <button onClick={() => step > 1 ? setStep(s => s-1) : null}
            className={`text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors ${step === 1 ? "opacity-0 pointer-events-none" : ""}`}>
            ← 이전
          </button>
          <PrimaryBtn onClick={() => canNext ? setStep(s => s+1) : null} className={canNext ? "" : "opacity-40 cursor-not-allowed hover:translate-y-0"}>
            {step === totalSteps ? "완료! 내 캘린더 만들기" : "다음 →"}
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

// ─── LANDING ──────────────────────────────────────────────────────────────────

const NOISE_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;

function useCountUp(target: number, d = 1200) {
  const [v, setV] = useState(0);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; ran.current = true;
    const s = Date.now();
    const t = () => { const p = Math.min((Date.now()-s)/d,1); setV(Math.round(p*target)); if(p<1) requestAnimationFrame(t); };
    requestAnimationFrame(t);
  }, [target, d]);
  return v;
}

function LandingPage({ onStart, onLogin, isDark, toggleDark }: { onStart:()=>void; onLogin:()=>void; isDark:boolean; toggleDark:()=>void }) {
  const c1 = useCountUp(12400), c2 = useCountUp(89), c3 = useCountUp(4800);
  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
      <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:"linear-gradient(135deg,#6C4CE0,#3B82F6)" }}>
              <span className="text-white text-xs font-black">O</span>
            </div>
            <span className="font-black text-sm text-foreground">오늘핀</span>
          </div>
          <div className="flex items-center gap-3">
            <DarkToggle isDark={isDark} toggle={toggleDark} />
            <button onClick={onLogin} className="text-sm text-muted-foreground hover:text-foreground font-medium transition-colors">로그인</button>
            <PrimaryBtn onClick={onStart} small>시작하기</PrimaryBtn>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div>
          <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.5 }}
            className="flex flex-wrap gap-2 mb-6">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/8 text-primary text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" /> 뮤지컬 · 콘서트 · 페스티벌 · K-pop
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-semibold">
              <Check size={10} /> 기본 기능 평생 무료
            </span>
          </motion.div>
          <motion.h1 initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.55, delay:0.08 }}
            className="text-[52px] font-black leading-[1.05] tracking-tight text-foreground mb-5">
            내가 직접 만드는<br />
            <span style={{ background:"linear-gradient(135deg,#6C4CE0,#3B82F6)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>내 공연 캘린더.</span>
          </motion.h1>
          <motion.p initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.5, delay:0.16 }}
            className="text-[17px] text-muted-foreground leading-relaxed mb-10 max-w-md">
            색 테마, 최애, 알림 방식을 직접 골라<br />나만의 공연 캘린더를 만드세요.
          </motion.p>
          <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.5, delay:0.24 }} className="flex gap-3">
            <PrimaryBtn onClick={onStart}>무료로 시작하기 <ArrowRight size={16} /></PrimaryBtn>
            <button onClick={onLogin} className="px-6 py-3.5 rounded-full border border-border text-sm font-semibold text-foreground hover:bg-muted transition-colors">로그인</button>
          </motion.div>
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.6, delay:0.4 }} className="flex gap-8 mt-10">
            {[{v:c1.toLocaleString(),l:"누적 기록"},{v:c2+"개+",l:"등록된 공연"},{v:c3.toLocaleString(),l:"관람 이용자"}].map(({v,l}) => (
              <div key={l}><div className="text-2xl font-black text-foreground">{v}</div><div className="text-xs text-muted-foreground mt-0.5">{l}</div></div>
            ))}
          </motion.div>
        </div>
        <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }} transition={{ duration:0.6, delay:0.2 }}
          className="grid grid-cols-2 gap-3">
          <div className="col-span-1 row-span-2 rounded-2xl p-6 flex flex-col justify-between text-white min-h-[240px] relative overflow-hidden"
            style={{ background:"linear-gradient(145deg,#2D1B69,#7C3AED)" }}>
            <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage:"radial-gradient(circle, white 1px, transparent 1px)", backgroundSize:"20px 20px" }} />
            <div className="relative">
              <div className="text-[9px] font-semibold opacity-60 uppercase tracking-widest mb-1">뮤지컬</div>
              <div className="text-3xl font-black leading-tight">HADES</div>
            </div>
            <div className="relative">
              <div className="text-[10px] opacity-60 mb-0.5">다음 관람까지</div>
              <div className="text-3xl font-black">D-14</div>
            </div>
          </div>
          <div className="rounded-2xl bg-muted p-4"><div className="text-[10px] font-semibold text-muted-foreground">이번 달 지출</div><div className="text-xl font-black text-foreground mt-1">₩382,000</div></div>
          <div className="rounded-2xl border border-border bg-card p-4"><div className="text-[10px] font-semibold text-muted-foreground">누적 관람</div><div className="flex gap-3 mt-1"><div><div className="text-xl font-black text-foreground">8</div><div className="text-[9px] text-muted-foreground">공연</div></div><div><div className="text-xl font-black text-foreground">3</div><div className="text-[9px] text-muted-foreground">뮤지컬</div></div></div></div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-12 border-t border-border">
        <motion.div initial={{ opacity:0, y:20 }} whileInView={{ opacity:1, y:0 }} viewport={{ once:true }} transition={{ duration:0.5 }}>
          <h2 className="text-xl font-black text-foreground mb-8">오늘핀이 할 수 있는 것</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { icon:Calendar, title:"내가 만드는 캘린더", desc:"색 테마·최애·알림 방식을 직접 설정. 회사가 만든 캘린더가 아닌, 내 캘린더.", color:"#6C4CE0" },
              { icon:BookOpen, title:"관람 다이어리",      desc:"티켓 스텁 형태로 좌석·캐스팅·감상을 기록. Letterboxd식 공연 아카이브.", color:"#3B82F6" },
              { icon:Users,    title:"공연 커뮤니티",      desc:"관람 기록을 공개하면 작품별 방에 자동 노출. 시야 공유, 동행 구하기.", color:"#EC4899" },
            ].map(({icon:Icon,title,desc,color}) => (
              <div key={title} className="p-6 rounded-2xl border border-border bg-card hover:border-primary/20 hover:-translate-y-0.5 transition-all">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white mb-5" style={{ background:color }}><Icon size={18} /></div>
                <h3 className="font-bold text-[15px] text-foreground mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Ticketing */}
      <section className="max-w-6xl mx-auto px-6 py-12 border-t border-border">
        <motion.div initial={{ opacity:0, y:20 }} whileInView={{ opacity:1, y:0 }} viewport={{ once:true }}>
          <div className="flex items-center gap-2 mb-6"><Ticket size={16} className="text-primary" /><h2 className="text-lg font-black text-foreground">이번 주 놓치면 안 되는 티켓팅</h2></div>
          <div className="grid grid-cols-3 gap-3">
            {TICKETING_SOON.map((t,i) => { const art = ARTISTS.find(a=>a.id===t.artistId)!; return (
              <motion.div key={i} initial={{ opacity:0, y:16 }} whileInView={{ opacity:1, y:0 }} viewport={{ once:true }} transition={{ delay:i*0.07 }}
                className="flex items-center gap-3 p-4 rounded-2xl border border-border bg-card hover:border-primary/25 hover:-translate-y-0.5 transition-all cursor-pointer group">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-[9px] font-black" style={{ background:`linear-gradient(135deg,${art.from},${art.to})` }}>{art.short.length>4?<span className="text-[7px]">{art.short}</span>:art.short}</div>
                <div className="flex-1 min-w-0"><div className="text-sm font-semibold text-foreground truncate">{t.title}</div><div className="text-[11px] text-muted-foreground">{t.site}</div></div>
                <div className="text-right flex-shrink-0"><div className="text-xs font-black text-primary">{t.date}</div><div className="flex items-center gap-0.5 text-[10px] text-muted-foreground group-hover:text-primary transition-colors justify-end mt-0.5">예매 <ExternalLink size={9}/></div></div>
              </motion.div>
            );})}
          </div>
        </motion.div>
      </section>

      {/* CTA */}
      <section className="border-t border-border py-20">
        <motion.div initial={{ opacity:0, y:20 }} whileInView={{ opacity:1, y:0 }} viewport={{ once:true }} className="max-w-xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-black text-foreground mb-3">내 캘린더를 지금 만들어보세요.</h2>
          <p className="text-muted-foreground mb-8">기본 기능 평생 무료. 2분 만에 시작.</p>
          <PrimaryBtn onClick={onStart} className="mx-auto">무료로 시작하기</PrimaryBtn>
        </motion.div>
      </section>
    </div>
  );
}

// ─── CALENDAR WIDGET (for Home) ───────────────────────────────────────────────

function CalendarWidget({ onEdit, calTheme, density }: { onEdit: () => void; calTheme: CalThemeId; density: "dot"|"title" }) {
  const t = CAL_THEMES[calTheme];
  const first = 3; // July 2026 Wednesday
  const DAYS = ["일","월","화","수","목","금","토"];
  const today = 22;
  const [sel, setSel] = useState<number|null>(null);

  return (
    <div className="bg-card rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-black text-foreground">내 캘린더</h2>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: t.preview }} />
            <span className="text-[11px] text-muted-foreground">{t.name} 테마 · {density === "dot" ? "점 표시" : "제목 표시"}</span>
          </div>
        </div>
        <button onClick={onEdit} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          캘린더 편집하기 <ArrowRight size={11} />
        </button>
      </div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-bold text-foreground">2026. 07</span>
        <div className="flex gap-1">
          <button className="w-6 h-6 rounded-md hover:bg-muted flex items-center justify-center"><ChevronLeft size={12} className="text-muted-foreground" /></button>
          <button className="w-6 h-6 rounded-md hover:bg-muted flex items-center justify-center"><ChevronRight size={12} className="text-muted-foreground" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map((d,i) => <div key={d} className={`text-center text-[10px] font-bold py-1 ${i===0?"text-red-400":i===6?"text-blue-400":"text-muted-foreground"}`}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: first }).map((_,i) => <div key={`e${i}`} className="aspect-square" />)}
        {Array.from({ length: 31 }).map((_,i) => {
          const d = i+1;
          const evs = EVENTS.filter(e => e.date === d);
          const isToday = d === today;
          const isSel = d === sel;
          const dow = (first + i) % 7;
          return (
            <button key={d} onClick={() => setSel(isSel ? null : d)}
              className={`aspect-square flex flex-col items-center justify-start pt-1 gap-0.5 rounded-lg transition-all hover:bg-muted ${isSel ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold leading-none ${isToday ? "text-white" : dow===0?"text-red-400":dow===6?"text-blue-400":"text-foreground"}`}
                style={isToday ? { background: t.todayGrad } : {}}>
                {d}
              </span>
              <div className="flex gap-0.5 flex-wrap justify-center">
                {density === "dot" ? evs.slice(0,3).map((ev,idx) => {
                  const art = ARTISTS.find(a => a.id === ev.artistId)!;
                  const dotC = t.dot ?? art.dot;
                  return <span key={idx} className="w-1 h-1 rounded-full" style={{ backgroundColor: dotC }} />;
                }) : evs.slice(0,1).map((ev,idx) => (
                  <span key={idx} className="text-[7px] text-muted-foreground truncate max-w-[32px] leading-tight">{ev.title.slice(0,5)}</span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
      {sel && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-[10px] font-bold text-muted-foreground mb-2">7월 {sel}일 일정</div>
          <div className="space-y-1">
            {EVENTS.filter(e => e.date === sel).slice(0,2).map((ev,i) => {
              const art = ARTISTS.find(a => a.id === ev.artistId)!;
              return <div key={i} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: art.dot }} /><span className="text-[11px] font-medium text-foreground truncate">{ev.title}</span><CatBadge category={ev.category} /></div>;
            })}
            {EVENTS.filter(e => e.date === sel).length === 0 && <div className="text-[11px] text-muted-foreground">일정 없음</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────────────

function HomePage({ setPage, calTheme, density }: { setPage:(p:Page)=>void; calTheme:CalThemeId; density:"dot"|"title" }) {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-foreground">좋은 공연, 오늘도 즐기세요 ✨</h1>
        <p className="text-sm text-muted-foreground mt-1">2026년 7월 22일 수요일</p>
      </div>

      {/* Calendar widget - prominently at top */}
      <div className="mb-5">
        <CalendarWidget onEdit={() => setPage("calendar")} calTheme={calTheme} density={density} />
      </div>

      {/* Stats + D-day row */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        <div className="col-span-2 rounded-2xl p-5 flex flex-col justify-between text-white relative overflow-hidden" style={{ background:"linear-gradient(145deg,#2D1B69,#7C3AED)" }}>
          <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage:"radial-gradient(circle, white 1px, transparent 1px)", backgroundSize:"20px 20px" }} />
          <div className="relative text-[10px] opacity-60 uppercase tracking-widest">다음 관람까지</div>
          <div className="relative text-4xl font-black mt-1">D-14</div>
          <div className="relative text-[11px] opacity-70 mt-1">하데스타운 · 8.05 블루스퀘어</div>
        </div>
        <div className="col-span-3 grid grid-cols-3 gap-3">
          {[{l:"관람 공연",v:"8",u:"회"},{l:"본 뮤지컬",v:"2",u:"편"},{l:"총 지출",v:"₩382K",u:""}].map(({l,v,u}) => (
            <div key={l} className="rounded-2xl bg-muted p-4"><div className="text-[10px] font-semibold text-muted-foreground">{l}</div><div className="text-xl font-black text-foreground mt-1">{v}<span className="text-sm">{u}</span></div></div>
          ))}
        </div>
      </div>

      {/* HOT Stage + Upcoming */}
      <div className="grid grid-cols-2 gap-5">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2"><Play size={13} className="text-primary fill-primary" /><span className="text-sm font-bold text-foreground">HOT 스테이지</span></div>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {[{artistId:"hades" as ArtistId,t:"하데스타운",s:"D-14",b:"HOT"},{artistId:"svt" as ArtistId,t:"SVT 월드투어",s:"D-3",b:"D-3"},{artistId:"wicked" as ArtistId,t:"위키드",s:"예술의전당",b:"NEW"},{artistId:"rib" as ArtistId,t:"록인부산",s:"7.18-19",b:""}].map((show,i) => {
              const art = ARTISTS.find(a=>a.id===show.artistId)!;
              return (
                <div key={i} className="flex-shrink-0 w-[80px]">
                  <div className="w-full aspect-square rounded-xl flex items-center justify-center font-black text-white relative hover:-translate-y-0.5 transition-transform cursor-pointer"
                    style={{ background:`linear-gradient(145deg,${art.from},${art.to})`, fontSize:art.short.length>4?"9px":"12px" }}>
                    {art.short}
                    {show.b && <span className="absolute top-1 right-1 text-[7px] font-black px-1 py-0.5 rounded bg-white/25">{show.b}</span>}
                  </div>
                  <div className="text-[10px] font-semibold text-foreground text-center truncate mt-1">{show.t}</div>
                  <div className="text-[9px] text-muted-foreground text-center">{show.s}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2"><Calendar size={14} className="text-primary" /><span className="text-sm font-bold text-foreground">다가오는 일정</span></div>
            <button onClick={() => setPage("calendar")} className="text-xs text-primary font-semibold flex items-center gap-1 hover:underline">캘린더 <ArrowRight size={11}/></button>
          </div>
          <div className="space-y-2">
            {[
              { day:"오늘", artistId:"svt" as ArtistId, cat:"팬미팅" as Category, title:"SVT 팬미팅", time:"19:00" },
              { day:"7.25", artistId:"svt" as ArtistId, cat:"콘서트" as Category, title:"SVT 월드투어 서울", time:"18:00" },
              { day:"8.05", artistId:"hades" as ArtistId, cat:"뮤지컬" as Category, title:"하데스타운", time:"19:30" },
            ].map((ev,i) => { const art = ARTISTS.find(a=>a.id===ev.artistId)!; return (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted transition-colors cursor-pointer">
                <div className={`text-xs font-bold w-9 text-center flex-shrink-0 ${ev.day==="오늘"?"text-primary":"text-muted-foreground"}`}>{ev.day}</div>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black flex-shrink-0" style={{ background:`linear-gradient(135deg,${art.from},${art.to})`, fontSize:art.short.length>4?"7px":"10px" }}>{art.short}</div>
                <div className="flex-1 min-w-0"><div className="text-xs font-semibold text-foreground truncate">{ev.title}</div><div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5"><Clock size={8}/>{ev.time}</div></div>
                <CatBadge category={ev.cat} />
              </div>
            );})}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CALENDAR ─────────────────────────────────────────────────────────────────

function CalendarPage({
  year, month, sel, setSel, onPrev, onNext, firstDay, daysInMonth,
  calTheme, setCalTheme, density, setDensity, startDay, setStartDay,
}: {
  year:number; month:number; sel:number|null; setSel:(d:number|null)=>void;
  onPrev:()=>void; onNext:()=>void; firstDay:number; daysInMonth:number;
  calTheme:CalThemeId; setCalTheme:(t:CalThemeId)=>void;
  density:"dot"|"title"; setDensity:(d:"dot"|"title")=>void;
  startDay:"sun"|"mon"; setStartDay:(d:"sun"|"mon")=>void;
}) {
  const [tab, setTab] = useState<"events"|"add"|"themes"|"cast">("events");
  const [actCats, setActCats] = useState<Set<Category>>(new Set(ALL_CATEGORIES));
  const [newEv, setNewEv] = useState({ title:"", date:"", time:"", cat:"콘서트" as Category, note:"", color:"#6C4CE0" });
  const [customEvs, setCustomEvs] = useState<{id:number;date:number;title:string;cat:Category;time:string;note:string;color:string}[]>([]);

  const t = CAL_THEMES[calTheme];
  const today = 22;
  const toggleCat = (c:Category) => { const n = new Set(actCats); n.has(c) ? n.delete(c) : n.add(c); setActCats(n); };
  const evForDay = (d:number) => EVENTS.filter(e => e.date===d && actCats.has(e.category));
  const selEvs = sel ? evForDay(sel) : [];
  const selCust = sel ? customEvs.filter(e => e.date===sel) : [];

  const ordDays = startDay === "sun" ? ["일","월","화","수","목","금","토"] : ["월","화","수","목","금","토","일"];
  const fOff = startDay === "mon" ? (firstDay === 0 ? 6 : firstDay-1) : firstDay;

  const COLORS = ["#6C4CE0","#3B82F6","#EC4899","#F59E0B","#10B981","#EF4444"];

  return (
    <div className="flex h-full">
      {/* Main */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="flex flex-wrap gap-2 mb-5">
          {ALL_CATEGORIES.map(cat => (
            <button key={cat} onClick={() => toggleCat(cat)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${actCats.has(cat) ? "text-white" : "bg-muted text-muted-foreground hover:bg-secondary"}`}
              style={actCats.has(cat) ? { background:"linear-gradient(135deg,#6C4CE0,#3B82F6)" } : {}}>
              {cat}
            </button>
          ))}
        </div>

        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-black text-foreground">{year}. {String(month).padStart(2,"0")}</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-3 h-3 rounded-sm" style={{ background: t.preview }} />
                <span className="text-[10px] text-muted-foreground">{t.name} 테마</span>
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={onPrev} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center"><ChevronLeft size={16} className="text-muted-foreground" /></button>
              <button onClick={onNext} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center"><ChevronRight size={16} className="text-muted-foreground" /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 mb-2">
            {ordDays.map((d,i) => <div key={d} className={`text-center text-xs font-bold py-1.5 ${startDay==="sun" ? (i===0?"text-red-400":i===6?"text-blue-400":"text-muted-foreground") : (i===5?"text-blue-400":i===6?"text-red-400":"text-muted-foreground")}`}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: fOff }).map((_,i) => <div key={`e${i}`} className="aspect-square" />)}
            {Array.from({ length: daysInMonth }).map((_,i) => {
              const d = i+1;
              const evs = evForDay(d);
              const cEvs = customEvs.filter(e => e.date===d);
              const isToday = d===today, isSel=d===sel;
              const dow = (firstDay+i)%7;
              const isSun = dow===0;
              return (
                <button key={d} onClick={() => { setSel(isSel?null:d); setTab("events"); }}
                  className={`aspect-square flex flex-col items-center justify-start pt-1.5 gap-0.5 rounded-xl transition-all hover:bg-muted ${isSel?"bg-primary/10 ring-1 ring-primary/30":""}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold leading-none ${isToday?"text-white":isSun?"text-red-400":dow===6?"text-blue-400":"text-foreground"}`}
                    style={isToday ? { background: t.todayGrad } : {}}>
                    {d}
                  </span>
                  <div className="flex gap-0.5 flex-wrap justify-center px-0.5">
                    {density==="dot" ? (
                      <>
                        {evs.slice(0,3).map((ev,idx) => { const art=ARTISTS.find(a=>a.id===ev.artistId)!; const dc=t.dot??art.dot; return <span key={idx} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor:dc }} />; })}
                        {cEvs.slice(0,1).map((ev,idx) => <span key={`c${idx}`} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor:ev.color }} />)}
                      </>
                    ) : evs.slice(0,1).map((ev,idx) => <span key={idx} className="text-[7px] text-muted-foreground truncate max-w-[36px]">{ev.title.slice(0,5)}</span>)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Ticketing */}
        <div className="mt-4 bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center gap-2 mb-3"><Ticket size={13} className="text-primary" /><span className="text-sm font-bold text-foreground">티켓팅 오픈 예정</span></div>
          <div className="space-y-2">
            {TICKETING_SOON.map((t2,i) => { const art=ARTISTS.find(a=>a.id===t2.artistId)!; return (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted transition-colors cursor-pointer group">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black" style={{ background:`linear-gradient(135deg,${art.from},${art.to})`, fontSize:art.short.length>4?"7px":"10px" }}>{art.short}</div>
                <div className="flex-1 min-w-0"><div className="text-xs font-semibold text-foreground truncate">{t2.title}</div><div className="text-[10px] text-muted-foreground">{t2.site}</div></div>
                <div className="text-right flex-shrink-0"><div className="text-xs font-black text-primary">{t2.date}</div><div className="flex items-center gap-0.5 text-[9px] text-muted-foreground group-hover:text-primary justify-end mt-0.5">예매 <ExternalLink size={8}/></div></div>
              </div>
            );})}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="w-[280px] flex-shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
        <div className="flex border-b border-border flex-shrink-0">
          {([{id:"events" as const,l:"일정",icon:Calendar},{id:"add" as const,l:"추가",icon:Plus},{id:"themes" as const,l:"테마",icon:Layers},{id:"cast" as const,l:"캐스팅",icon:Users}]).map(({id,l,icon:Icon}) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 flex items-center justify-center gap-1 py-3 text-[10px] font-semibold transition-colors ${tab===id?"text-primary border-b-2 border-primary":"text-muted-foreground hover:text-foreground"}`}>
              <Icon size={11}/>{l}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "events" && (
            <>
              {sel ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-sm text-foreground">{month}월 {sel}일</h3>
                    <button onClick={() => setSel(null)} className="text-muted-foreground hover:text-foreground"><X size={14}/></button>
                  </div>
                  {[...selEvs, ...selCust.map(c => ({...c,artistId:null as any,hasTicket:false,isCustom:true}))].length === 0 ? (
                    <div className="text-center py-8"><div className="text-2xl mb-2">📅</div><div className="text-xs text-muted-foreground">일정 없음</div><button onClick={() => setTab("add")} className="mt-2 text-xs text-primary font-semibold hover:underline">+ 직접 추가</button></div>
                  ) : (
                    <div className="space-y-2">
                      {selEvs.map((ev,i) => { const art=ARTISTS.find(a=>a.id===ev.artistId)!; return (
                        <div key={i} className="p-3 rounded-xl bg-muted relative overflow-hidden">
                          <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ backgroundColor:(t.dot??art.dot) }} />
                          <div className="pl-1.5">
                            <div className="flex items-center gap-1.5 mb-1"><CatBadge category={ev.category} />{ev.hasTicket && <span className="text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md">티켓팅</span>}</div>
                            <div className="text-xs font-semibold text-foreground">{ev.title}</div>
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5"><Clock size={9}/>{ev.time}{ev.venue&&<><MapPin size={9}/>{ev.venue}</>}</div>
                          </div>
                        </div>
                      );})}
                      {selCust.map((ev,i) => (
                        <div key={`c${i}`} className="p-3 rounded-xl bg-muted relative overflow-hidden">
                          <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ backgroundColor:ev.color }} />
                          <div className="pl-1.5"><span className="text-[9px] font-semibold text-muted-foreground">내 일정</span><div className="text-xs font-semibold text-foreground">{ev.title}</div>{ev.time&&<div className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock size={9}/>{ev.time}</div>}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : <div className="text-center py-10 text-xs text-muted-foreground">날짜를 선택하면<br />일정을 확인할 수 있어요</div>}

              <div className="mt-5 pt-4 border-t border-border">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5"><Filter size={9}/> 최애 필터</div>
                {ARTISTS.map(art => (
                  <div key={art.id} className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-muted transition-colors">
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ backgroundColor:art.dot }} /><span className="text-xs font-medium text-foreground">{art.name}</span></div>
                    <span className="text-[9px] text-muted-foreground">{art.category}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "add" && (
            <div>
              <h3 className="font-bold text-sm text-foreground mb-4">나만의 일정 추가</h3>
              <div className="space-y-3">
                <div><label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1.5">제목 *</label>
                  <input value={newEv.title} onChange={e => setNewEv(p=>({...p,title:e.target.value}))} placeholder="예: 하데스타운 응모 마감" className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1.5">날짜 *</label>
                    <input type="number" value={newEv.date} onChange={e=>setNewEv(p=>({...p,date:e.target.value}))} placeholder="22" min={1} max={31} className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary" /></div>
                  <div><label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1.5">시간</label>
                    <input value={newEv.time} onChange={e=>setNewEv(p=>({...p,time:e.target.value}))} placeholder="19:30" className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary" /></div>
                </div>
                <div><label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1.5">색상</label>
                  <div className="flex gap-2">{COLORS.map(c => <button key={c} onClick={()=>setNewEv(p=>({...p,color:c}))} className={`w-6 h-6 rounded-full transition-all ${newEv.color===c?"ring-2 ring-offset-2 ring-offset-card ring-foreground/30 scale-110":""}`} style={{ backgroundColor:c }} />)}</div></div>
                <div><label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1.5">메모</label>
                  <textarea value={newEv.note} onChange={e=>setNewEv(p=>({...p,note:e.target.value}))} placeholder="나만 아는 메모..." rows={2} className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary resize-none" /></div>
                <button onClick={() => { if(!newEv.title||!newEv.date) return; setCustomEvs(p=>[...p,{...newEv,date:Number(newEv.date),id:Date.now(),cat:newEv.cat}]); setNewEv({title:"",date:"",time:"",cat:"콘서트",note:"",color:"#6C4CE0"}); setTab("events"); }}
                  className="w-full py-3 rounded-xl text-white text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all" style={{ background:"linear-gradient(135deg,#6C4CE0,#3B82F6)" }}>
                  <Check size={14} className="inline mr-1.5" />일정 저장
                </button>
              </div>
            </div>
          )}

          {tab === "themes" && (
            <div>
              <h3 className="font-bold text-sm text-foreground mb-1">테마 스킨 갤러리</h3>
              <p className="text-[11px] text-muted-foreground mb-4">원하는 색감으로 캘린더를 꾸며보세요.</p>
              <div className="space-y-2">
                {(Object.keys(CAL_THEMES) as CalThemeId[]).map(tid => {
                  const th = CAL_THEMES[tid];
                  const isActive = calTheme === tid;
                  return (
                    <button key={tid} onClick={() => setCalTheme(tid)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${isActive?"border-primary bg-primary/8":"border-border bg-card hover:border-primary/30"}`}>
                      <div className="w-10 h-10 rounded-xl flex-shrink-0" style={{ background:th.preview }} />
                      <div className="text-left">
                        <div className="text-sm font-bold text-foreground">{th.name}</div>
                        <div className="text-[11px] text-muted-foreground">{th.label}</div>
                      </div>
                      {isActive && <Check size={14} className="text-primary ml-auto" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 p-3 rounded-xl bg-primary/6 text-[11px] text-primary font-medium flex items-center gap-2">
                <Sparkles size={11} /> 유저 제작 테마 공유 — 곧 오픈
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">표시 방식</div>
                <div className="flex gap-2">
                  {([{v:"dot" as const,l:"점만"},{v:"title" as const,l:"제목 표시"}]).map(({v,l}) => (
                    <button key={v} onClick={() => setDensity(v)} className={`flex-1 py-2.5 rounded-xl border-2 text-xs font-semibold transition-all ${density===v?"border-primary text-primary bg-primary/8":"border-border text-muted-foreground"}`}>{l}</button>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  {([{v:"sun" as const,l:"일요일 시작"},{v:"mon" as const,l:"월요일 시작"}]).map(({v,l}) => (
                    <button key={v} onClick={() => setStartDay(v)} className={`flex-1 py-2.5 rounded-xl border-2 text-xs font-semibold transition-all ${startDay===v?"border-primary text-primary bg-primary/8":"border-border text-muted-foreground"}`}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "cast" && (
            <div>
              <h3 className="font-bold text-sm text-foreground mb-1">캐스팅 필터</h3>
              <p className="text-[11px] text-muted-foreground mb-4">최애 배우가 나오는 회차만 캘린더에서 강조합니다.</p>
              {[
                { artistId:"hades" as ArtistId, casts:[{name:"박지연 (에우리디케)",dates:[5,12,22,31]},{name:"이아람 (에우리디케)",dates:[10,17,24]},{name:"김준현 (하데스)",dates:[5,12,22,31]}] },
                { artistId:"cats" as ArtistId,  casts:[{name:"전미도 (그리자벨라)",dates:[10,17,24]}] },
                { artistId:"wicked" as ArtistId,casts:[{name:"아이비 (엘파바)",dates:[16,23,27]}] },
              ].map(({artistId,casts}) => {
                const art = ARTISTS.find(a=>a.id===artistId)!;
                return (
                  <div key={artistId} className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <ArtCover artistId={artistId} size="xs" />
                      <span className="text-xs font-bold text-foreground">{art.name}</span>
                    </div>
                    <div className="space-y-1.5 ml-10">
                      {casts.map((cast,i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted hover:bg-secondary transition-colors cursor-pointer">
                          <div><div className="text-[11px] font-semibold text-foreground">{cast.name}</div><div className="text-[9px] text-muted-foreground">{cast.dates.join(", ")}일 출연</div></div>
                          <div className="w-8 h-4 rounded-full bg-muted border border-border flex items-center px-0.5"><div className="w-3 h-3 rounded-full bg-muted-foreground/40" /></div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="p-3 rounded-xl bg-muted text-[11px] text-muted-foreground">
                활성화하면 해당 배우 회차 날짜가 캘린더에서 특별 강조됩니다.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── COMMUNITY ────────────────────────────────────────────────────────────────

function CommunityPage() {
  const [activeRoom, setActiveRoom] = useState<string | null>(null);

  const TAG_COLORS: Record<string, string> = {
    "시야후기": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    "캐스팅잡담": "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    "동행": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    "스포주의": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    "초연후기": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    "라인업": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    "좌석시야": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
    "현장후기": "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  };

  const myRooms = COMMUNITY_ROOMS.filter(r => r.joined);
  const feedPosts = activeRoom ? COMMUNITY_POSTS.filter(p => p.roomId === activeRoom) : COMMUNITY_POSTS;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-foreground">커뮤니티</h1>
          <p className="text-sm text-muted-foreground mt-1">관람 기록을 공개하면 작품 방에 자동 노출됩니다.</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/8 text-primary text-xs font-semibold">
          <Sparkles size={12} />
          내 기록 = 콘텐츠
        </div>
      </div>

      {/* My rooms */}
      <div className="mb-6">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Users size={10} /> 내가 참여 중
        </div>
        <div className="grid grid-cols-2 gap-3">
          {myRooms.map(room => {
            const art = ARTISTS.find(a => a.id === room.artistId)!;
            return (
              <button key={room.id} onClick={() => setActiveRoom(activeRoom === room.id ? null : room.id)}
                className={`flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all hover:-translate-y-0.5 ${activeRoom === room.id ? "border-primary bg-primary/8" : "border-border bg-card"}`}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-black flex-shrink-0"
                  style={{ background:`linear-gradient(145deg,${art.from},${art.to})`, fontSize:art.short.length>4?"9px":"12px" }}>
                  {art.short}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-foreground truncate">{room.title}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{room.sub}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-muted-foreground">{room.members.toLocaleString()}명</span>
                    <span className="text-[10px] text-primary font-semibold">관람기록 {room.records}개</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Hot rooms horizontal scroll */}
      <div className="mb-6">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Flame size={10} className="text-orange-500" /> 인기 방
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COMMUNITY_ROOMS.map(room => {
            const art = ARTISTS.find(a => a.id === room.artistId)!;
            return (
              <button key={room.id} onClick={() => setActiveRoom(activeRoom === room.id ? null : room.id)}
                className={`flex-shrink-0 w-[160px] p-4 rounded-2xl border transition-all text-left hover:-translate-y-0.5 ${activeRoom === room.id ? "border-primary bg-primary/8" : "border-border bg-card"}`}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black mb-3"
                  style={{ background:`linear-gradient(145deg,${art.from},${art.to})`, fontSize:art.short.length>4?"8px":"11px" }}>
                  {art.short}
                </div>
                <div className="font-bold text-xs text-foreground truncate">{room.title}</div>
                <div className="text-[9px] text-muted-foreground mt-0.5">{room.posts}개 글 · {room.records}개 기록</div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {room.tags.slice(0,2).map(tag => (
                    <span key={tag} className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${TAG_COLORS[tag] ?? "bg-muted text-muted-foreground"}`}>{tag}</span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <MessageCircle size={10} />
            {activeRoom ? `${COMMUNITY_ROOMS.find(r=>r.id===activeRoom)?.title} — 최신 글` : "전체 최신 글"}
          </div>
          {activeRoom && <button onClick={() => setActiveRoom(null)} className="text-xs text-primary font-semibold hover:underline">전체 보기</button>}
        </div>
        <div className="space-y-3">
          {feedPosts.map(post => {
            const room = COMMUNITY_ROOMS.find(r => r.id === post.roomId)!;
            const art = ARTISTS.find(a => a.id === room.artistId)!;
            return (
              <motion.div key={post.id} initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.25 }}
                className="bg-card rounded-2xl border border-border p-5 hover:border-primary/20 hover:shadow-sm transition-all cursor-pointer">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black flex-shrink-0"
                    style={{ background:`linear-gradient(145deg,${art.from},${art.to})`, fontSize:art.short.length>4?"8px":"10px" }}>
                    {art.short}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[10px] font-semibold text-foreground">{room.title}</span>
                      {post.tags.map(tag => (
                        <span key={tag} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${TAG_COLORS[tag] ?? "bg-muted text-muted-foreground"}`}>{tag}</span>
                      ))}
                      {post.hasRecord && (
                        <span className="text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">관람기록 연결</span>
                      )}
                    </div>
                    <h4 className="font-bold text-sm text-foreground mb-1">{post.title}</h4>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{post.body}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-foreground">{post.avatar} {post.user}</span>
                    <span className="text-[9px] text-muted-foreground">· {post.time}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-red-500 transition-colors"><Heart size={11}/>{post.likes}</button>
                    <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"><MessageCircle size={11}/>{post.comments}</button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
        <button className="w-full mt-4 py-3 rounded-2xl border border-dashed border-border text-sm text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors font-medium">
          + 글 작성하기
        </button>
      </div>
    </div>
  );
}

// ─── DIARY ────────────────────────────────────────────────────────────────────

function TicketStubCard({ entry, onClose }: { entry: typeof DIARY_ENTRIES[0]; onClose:()=>void }) {
  const art = ARTISTS.find(a => a.id === entry.artistId)!;
  return (
    <motion.div initial={{ opacity:0, scale:0.96, y:10 }} animate={{ opacity:1, scale:1, y:0 }} transition={{ duration:0.25 }} className="mt-3 relative">
      <div className="relative flex bg-card rounded-2xl border border-border overflow-hidden shadow-lg shadow-black/5">
        <div className="w-1.5 flex-shrink-0" style={{ background:`linear-gradient(180deg,${art.from},${art.to})` }} />
        <div className="flex-1 p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-black flex-shrink-0"
              style={{ background:`linear-gradient(145deg,${art.from},${art.to})`, fontSize:art.short.length>4?"9px":"12px" }}>
              {art.short}
            </div>
            <div><div className="flex items-center gap-2 mb-0.5"><CatBadge category={entry.category} /></div><h4 className="text-sm font-black text-foreground leading-tight">{entry.title}</h4></div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4 text-xs">
            {[{l:"날짜",v:entry.date},{l:"좌석",v:entry.seat},{l:"공연장",v:entry.venue},{l:"동행",v:entry.companion}].map(({l,v}) => (
              <div key={l}><div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-0.5">{l}</div><div className="font-semibold text-foreground">{v}</div></div>
            ))}
            {entry.cast && <div className="col-span-2"><div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-0.5">캐스팅</div><div className="font-semibold text-foreground text-[11px]">{entry.cast}</div></div>}
          </div>
          <div className="bg-muted rounded-xl p-3 mb-3"><p className="text-xs text-foreground leading-relaxed">{entry.memo}</p></div>
          <div className="flex items-center justify-between">
            <div className="flex gap-0.5">{Array.from({length:5}).map((_,i) => <Star key={i} size={12} className={i<entry.rating?"fill-amber-400 text-amber-400":"text-border fill-border"} />)}</div>
            <div className="text-sm font-black text-foreground">₩{entry.amount.toLocaleString()}</div>
          </div>
        </div>
        <div className="relative flex-shrink-0 w-0 flex items-center">
          <div className="absolute top-0 bottom-0 border-l border-dashed border-border" />
          <div className="absolute -top-3 w-6 h-6 rounded-full bg-background" style={{ left:"-12px" }} />
          <div className="absolute -bottom-3 w-6 h-6 rounded-full bg-background" style={{ left:"-12px" }} />
        </div>
        <div className="w-28 flex-shrink-0 p-4 flex flex-col items-center justify-between bg-muted/40">
          <div className="text-center"><div className="text-[10px] font-black text-foreground">{art.name.slice(0,4)}</div><div className="text-[9px] text-muted-foreground mt-0.5">{entry.date.slice(5)}</div></div>
          <div className="flex gap-0.5 items-end h-10">{[3,5,2,6,4,2,5,3,4,6,2,4,3].map((h,i) => <div key={i} className="bg-foreground/20 w-0.5 rounded-full" style={{ height:`${h*6}%` }} />)}</div>
          <div className="text-[8px] font-black text-muted-foreground tracking-widest">{String(entry.id).padStart(6,"0")}</div>
        </div>
      </div>
      <button onClick={onClose} className="absolute top-3 right-3 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors z-10"><X size={12}/></button>
    </motion.div>
  );
}

function DiaryPage() {
  const [openId, setOpenId] = useState<number|null>(null);
  const total = DIARY_ENTRIES.reduce((s,e) => s+e.amount, 0);
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div><h1 className="text-2xl font-black text-foreground">관람 기록장</h1><p className="text-sm text-muted-foreground mt-1">공연, 뮤지컬, 페스티벌 — 소중한 순간을 모두.</p></div>
        <PrimaryBtn small><Plus size={14}/>기록 추가</PrimaryBtn>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-8">
        {[{l:"콘서트",v:DIARY_ENTRIES.filter(e=>e.category==="콘서트").length,u:"회"},{l:"뮤지컬",v:DIARY_ENTRIES.filter(e=>e.category==="뮤지컬").length,u:"편"},{l:"총 기록",v:DIARY_ENTRIES.length,u:"개"},{l:"총 지출",v:`₩${total.toLocaleString()}`,u:""}].map(({l,v,u}) => (
          <div key={l} className="rounded-2xl border border-border bg-card p-4"><div className="text-[10px] font-semibold text-muted-foreground mb-1">{l}</div><div className="text-lg font-black text-foreground">{v}<span className="text-sm font-semibold">{u}</span></div></div>
        ))}
      </div>
      <div className="space-y-2">
        {DIARY_ENTRIES.map(entry => { const art=ARTISTS.find(a=>a.id===entry.artistId)!; const isOpen=openId===entry.id; return (
          <div key={entry.id}>
            <button onClick={() => setOpenId(isOpen?null:entry.id)} className={`w-full text-left rounded-2xl border transition-all hover:border-primary/20 overflow-hidden ${isOpen?"border-primary/30 shadow-sm":"border-border bg-card"}`}>
              <div className="p-4 flex items-center gap-4 bg-card">
                <div className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-black flex-shrink-0"
                  style={{ background:`linear-gradient(145deg,${art.from},${art.to})`, fontSize:art.short.length>4?"9px":"13px" }}>
                  {art.short}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5"><span className="text-xs font-bold text-foreground">{art.name}</span><CatBadge category={entry.category} /></div>
                  <div className="text-sm font-semibold text-foreground truncate">{entry.title}</div>
                  {!isOpen && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{entry.memo}</div>}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-muted-foreground">{entry.date}</div>
                  <div className="text-sm font-black text-foreground mt-0.5">₩{entry.amount.toLocaleString()}</div>
                  <div className="flex justify-end gap-0.5 mt-1">{Array.from({length:5}).map((_,i) => <Star key={i} size={9} className={i<entry.rating?"fill-amber-400 text-amber-400":"text-border fill-border"} />)}</div>
                </div>
              </div>
            </button>
            {isOpen && <TicketStubCard entry={entry} onClose={() => setOpenId(null)} />}
          </div>
        );})}
      </div>
      <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background:"linear-gradient(135deg,#6C4CE0,#3B82F6)" }}><Ticket size={28} className="text-white" /></div>
        <div className="text-sm font-bold text-foreground mb-1">첫 관람 기록을 남겨보세요</div>
        <div className="text-xs text-muted-foreground max-w-xs mx-auto">공연, 뮤지컬, 페스티벌... 내 최애의 모든 순간이 여기 모입니다.</div>
        <PrimaryBtn small className="mt-5 mx-auto"><Plus size={14}/>첫 기록 시작</PrimaryBtn>
      </div>
    </div>
  );
}

// ─── MY ───────────────────────────────────────────────────────────────────────

function MyPage({ isDark, toggleDark }: { isDark:boolean; toggleDark:()=>void }) {
  const [myTab, setMyTab] = useState<"recap"|"timeline">("recap");

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-black text-foreground">마이</h1><p className="text-sm text-muted-foreground mt-1">관람 레벨, 연간 결산, 내 공연 역사.</p></div>
        <DarkToggle isDark={isDark} toggle={toggleDark} />
      </div>

      {/* Level + Recap/Timeline */}
      <div className="grid grid-cols-2 gap-5 mb-5">
        {/* Level */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-5 flex items-center gap-1.5"><Trophy size={11} className="text-primary"/> 관람 레벨</div>
          <div className="flex flex-col items-center mb-5">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-4xl mb-3 shadow-lg shadow-amber-200/50">🔥</div>
            <div className="text-xl font-black text-foreground">열정</div>
            <div className="text-sm text-muted-foreground mt-0.5">누적 기록 <span className="font-bold text-foreground">3개</span></div>
          </div>
          <p className="text-xs text-muted-foreground text-center mb-5 leading-relaxed">공연도 뮤지컬도 놓치지 않는 열정 가득한 관람러.</p>
          <div className="space-y-3">
            <div className="flex justify-between items-end">
              {[{k:"새싹",i:"🌱"},{k:"열정",i:"🔥"},{k:"마스터",i:"⭐"}].map((l,i) => (
                <div key={l.k} className="text-center"><div className={`text-xl transition-opacity ${i<=1?"opacity-100":"opacity-25"}`}>{l.i}</div><div className={`text-[10px] font-semibold mt-0.5 ${i===1?"text-primary":"text-muted-foreground"}`}>{l.k}</div></div>
              ))}
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width:"60%", background:"linear-gradient(90deg,#6C4CE0,#3B82F6)" }} /></div>
            <div className="text-[10px] text-muted-foreground text-center">마스터까지 <span className="font-bold text-foreground">2개</span> 남음</div>
          </div>
        </div>

        {/* Recap / Timeline tabs */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex border-b border-border">
            {([{id:"recap" as const,l:"2026 결산"},{id:"timeline" as const,l:"내 공연 역사"}]).map(({id,l}) => (
              <button key={id} onClick={() => setMyTab(id)}
                className={`flex-1 py-3 text-xs font-bold transition-colors ${myTab===id?"text-primary border-b-2 border-primary":"text-muted-foreground hover:text-foreground"}`}>
                {l}
              </button>
            ))}
          </div>

          {myTab === "recap" && (
            <div className="relative h-full" style={{ background:"linear-gradient(145deg, #5B3FD4, #2563EB 55%, #4F46E5)" }}>
              <div className="absolute inset-0 opacity-[0.06] mix-blend-overlay" style={{ backgroundImage:NOISE_SVG, backgroundSize:"300px 300px" }} />
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/5" />
              <div className="relative p-5 text-white flex flex-col h-full min-h-[280px]">
                <div className="flex items-center justify-between mb-4">
                  <div><div className="text-[8px] font-bold opacity-50 uppercase tracking-[0.15em]">연간 관람 결산</div><div className="text-[10px] font-black opacity-30">2026</div></div>
                  <BarChart3 size={16} className="opacity-50" />
                </div>
                <div className="mb-3"><div className="text-[9px] font-semibold opacity-60 mb-0.5">올해 본 공연</div><div className="text-4xl font-black leading-none">8<span className="text-xl opacity-60 ml-1">편</span></div></div>
                <div className="space-y-2 flex-1">
                  {[{l:"최애 작품",v:"하데스타운"},{l:"최다 관람",v:"SVT 콘서트"},{l:"총 관람 시간",v:"약 32시간"},{l:"총 지출",v:"₩382,000"},{l:"관람 레벨",v:"🔥 열정"}].map(({l,v}) => (
                    <div key={l} className="flex items-center justify-between"><div className="text-[10px] opacity-55">{l}</div><div className="text-[10px] font-black">{v}</div></div>
                  ))}
                </div>
                <button className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 transition-colors text-xs font-bold">
                  <Share2 size={12}/> 이미지로 저장/공유
                </button>
              </div>
            </div>
          )}

          {myTab === "timeline" && (
            <div className="p-5 overflow-y-auto max-h-[320px]">
              <div className="text-xs font-bold text-foreground mb-4">내 인생 공연사 ✨</div>
              {TIMELINE.map(({ year, items }) => (
                <div key={year} className="mb-5">
                  <div className="text-sm font-black text-foreground mb-3">{year}년</div>
                  <div className="ml-3 border-l-2 border-border pl-4 space-y-3">
                    {items.map((item, i) => {
                      const art = ARTISTS.find(a => a.id === item.artistId)!;
                      return (
                        <div key={i} className="relative">
                          <div className="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full border-2 border-primary bg-card" />
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black flex-shrink-0"
                              style={{ background:`linear-gradient(145deg,${art.from},${art.to})`, fontSize:art.short.length>4?"7px":"9px" }}>
                              {art.short}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-foreground">{item.title}</span>
                                {item.isFirst && <span className="text-[8px] font-bold text-white bg-primary px-1.5 py-0.5 rounded-full">첫 공연</span>}
                                {item.isUpcoming && <span className="text-[8px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">예정</span>}
                              </div>
                              <div className="text-[10px] text-muted-foreground">{year}.{String(item.month).padStart(2,"0")}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Settings + Export */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">계정 설정</div>
        <div className="space-y-0.5 mb-5">
          {[{l:"최애 / 관심 공연 관리",icon:Star},{l:"알림 설정",icon:Bell},{l:`화면: ${isDark?"다크":"라이트"} 모드`,icon:isDark?Sun:Moon,action:toggleDark}].map(({l,icon:Icon,action}) => (
            <button key={l} onClick={action} className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium hover:bg-muted transition-colors text-foreground">
              <div className="flex items-center gap-2.5"><Icon size={14} className="text-muted-foreground"/>{l}</div>
              <ChevronRight size={14} className="text-muted-foreground"/>
            </button>
          ))}
        </div>
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Download size={10}/> 기록 내보내기
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-muted/40 hover:bg-muted transition-colors text-sm font-semibold text-foreground">
            <ImageIcon size={14} className="text-primary"/>이미지로 저장
          </button>
          <button className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-muted/40 hover:bg-muted transition-colors text-sm font-semibold text-foreground">
            <Download size={14} className="text-primary"/>CSV 내보내기
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── APP SHELL ────────────────────────────────────────────────────────────────

function OneulpinApp() {
  const [page, setPage] = useState<Page>("landing");
  const [isDark, setIsDark] = useState(false);

  // Calendar state (shared between home widget + calendar page)
  const [calYear, setCalYear] = useState(2026);
  const [calMonth, setCalMonth] = useState(7);
  const [selDay, setSelDay] = useState<number|null>(22);
  const [calTheme, setCalTheme] = useState<CalThemeId>("default");
  const [density, setDensity] = useState<"dot"|"title">("dot");
  const [startDay, setStartDay] = useState<"sun"|"mon">("sun");

  const toggleDark = () => setIsDark(d => !d);

  const dIM = (y:number,m:number) => new Date(y,m,0).getDate();
  const fDoM = (y:number,m:number) => new Date(y,m-1,1).getDay();

  if (page === "landing") {
    return (
      <div className={isDark ? "dark" : ""} style={{ fontFamily:"'Pretendard', -apple-system, sans-serif" }}>
        <LandingPage
          onStart={() => setPage("onboarding")}
          onLogin={() => setPage("home")}
          isDark={isDark} toggleDark={toggleDark}
        />
      </div>
    );
  }

  if (page === "onboarding") {
    return (
      <div className={isDark ? "dark" : ""} style={{ fontFamily:"'Pretendard', -apple-system, sans-serif" }}>
        <OnboardingPage onComplete={() => setPage("home")} isDark={isDark} toggleDark={toggleDark} />
      </div>
    );
  }

  const NAV_ITEMS: { id: Page; label: string; icon: React.ComponentType<{ size: number }> }[] = [
    { id:"home",      label:"홈",       icon:Home },
    { id:"calendar",  label:"캘린더",    icon:Calendar },
    { id:"diary",     label:"관람 기록", icon:BookOpen },
    { id:"community", label:"커뮤니티",  icon:Users },
    { id:"my",        label:"마이",      icon:User },
  ];

  return (
    <div className={`flex h-screen overflow-hidden ${isDark ? "dark" : ""}`} style={{ fontFamily:"'Pretendard', -apple-system, sans-serif" }}>
      {/* Sidebar */}
      <nav className="w-[160px] flex-shrink-0 border-r border-border bg-card flex flex-col py-5 gap-0.5">
        <div className="px-4 mb-5">
          <button onClick={() => setPage("landing")} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:"linear-gradient(135deg,#6C4CE0,#3B82F6)" }}><span className="text-white text-xs font-black">O</span></div>
            <span className="font-black text-sm text-foreground">오늘핀</span>
          </button>
        </div>
        {NAV_ITEMS.map(({id,label,icon:Icon}) => (
          <button key={id} onClick={() => setPage(id)}
            className={`flex items-center gap-2.5 mx-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${page===id?"bg-primary/10 text-primary":"text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            <Icon size={15}/>{label}
          </button>
        ))}
        <div className="mt-auto mx-2">
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-muted">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-sm flex-shrink-0">🔥</div>
            <div className="min-w-0"><div className="text-xs font-bold text-foreground truncate">열정</div><div className="text-[10px] text-muted-foreground">관람 3회</div></div>
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <header className="h-14 border-b border-border bg-card flex items-center px-6 gap-4 flex-shrink-0">
          <div className="flex items-center gap-2 flex-1 max-w-sm px-3 py-2 rounded-xl bg-muted text-sm text-muted-foreground cursor-text">
            <Search size={13}/><span>공연, 뮤지컬, 아티스트 검색</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <DarkToggle isDark={isDark} toggle={toggleDark}/>
            <button className="text-muted-foreground hover:text-foreground transition-colors"><Bell size={17}/></button>
            <button className="text-sm text-muted-foreground hover:text-foreground font-medium transition-colors">로그인</button>
            <button className="text-sm px-3.5 py-1.5 rounded-full text-white font-semibold hover:opacity-90 transition-opacity" style={{ background:"linear-gradient(135deg,#6C4CE0,#3B82F6)" }}>회원가입</button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-background">
          {page === "home" && <HomePage setPage={setPage} calTheme={calTheme} density={density}/>}
          {page === "calendar" && (
            <CalendarPage
              year={calYear} month={calMonth} sel={selDay} setSel={setSelDay}
              onPrev={() => { if(calMonth===1){setCalYear(y=>y-1);setCalMonth(12);}else setCalMonth(m=>m-1); }}
              onNext={() => { if(calMonth===12){setCalYear(y=>y+1);setCalMonth(1);}else setCalMonth(m=>m+1); }}
              firstDay={fDoM(calYear,calMonth)} daysInMonth={dIM(calYear,calMonth)}
              calTheme={calTheme} setCalTheme={setCalTheme}
              density={density} setDensity={setDensity}
              startDay={startDay} setStartDay={setStartDay}
            />
          )}
          {page === "diary" && <DiaryPage/>}
          {page === "community" && <CommunityPage/>}
          {page === "my" && <MyPage isDark={isDark} toggleDark={toggleDark}/>}
        </main>
      </div>
    </div>
  );
}

const PUBLIC_NAV = [
  { to: "/how-it-works", label: "진행 방식", number: "01" },
  { to: "/two-starts", label: "두 가지 시작", number: "02" },
  { to: "/pricing", label: "이용 요금", number: "03" },
];

const MEMBER_NAV = [
  { to: "/today", label: "오늘", icon: Home },
  { to: "/us", label: "두 사람", icon: Users },
  { to: "/exchange", label: "교류", icon: MessageCircle },
  { to: "/meeting", label: "약속", icon: Calendar },
  { to: "/profile", label: "내 정보", icon: User },
];

const CONTROL_MOTION = "transition-colors duration-200 motion-reduce:transition-none";

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" aria-label={`${BEFORE_US.brand.name} 공개 홈`} className="flex w-fit items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
      <span aria-hidden="true" className="flex gap-1.5">
        <span className="size-3 rounded-full bg-primary" />
        <span className="size-3 rounded-full bg-accent" />
      </span>
      <span className="flex flex-col gap-1">
        <span className={`${compact ? "text-xl" : "text-2xl"} font-bold leading-none`}>{BEFORE_US.brand.name}</span>
        <span className="text-[9px] font-semibold leading-none tracking-[0.18em] text-muted-foreground">{BEFORE_US.brand.english}</span>
      </span>
    </Link>
  );
}

function ShellThemeToggle({ isDark, toggle }: { isDark: boolean; toggle: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"} className={`rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${CONTROL_MOTION}`}>
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </Button>
  );
}

function PageTransition() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  return <motion.div key={location.pathname} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : 0.24 }} className="flex flex-1 flex-col"><Outlet /></motion.div>;
}

function PublicShell({ isDark, toggle }: { isDark: boolean; toggle: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex min-h-24 max-w-7xl items-center justify-between gap-5 px-5 sm:px-8 lg:px-12">
          <Brand />
          <nav aria-label="공개 메뉴" className="hidden items-center gap-8 lg:flex">
            {PUBLIC_NAV.map(item => <NavLink key={item.to} to={item.to} className={({ isActive }) => `rounded-sm py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${CONTROL_MOTION} ${isActive ? "text-primary" : "text-foreground hover:text-primary"}`}>{item.label}</NavLink>)}
          </nav>
          <div className="flex items-center gap-2 sm:gap-4">
            <ShellThemeToggle isDark={isDark} toggle={toggle} />
            <Button asChild variant="ghost" className={`hidden hover:bg-muted hover:text-foreground sm:inline-flex ${CONTROL_MOTION}`}><Link to="/login">로그인</Link></Button>
            <Button asChild className={`h-11 rounded-full px-5 ${CONTROL_MOTION}`}><Link to="/apply">소개 신청하기 <ArrowRight size={15} /></Link></Button>
            <Button variant="ghost" size="icon" aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"} aria-expanded={menuOpen} aria-controls="public-mobile-menu" onClick={() => setMenuOpen(open => !open)} className={`lg:hidden hover:bg-muted hover:text-foreground ${CONTROL_MOTION}`}>
              {menuOpen ? <X /> : <Menu />}
            </Button>
          </div>
        </div>
        {menuOpen && <nav id="public-mobile-menu" aria-label="모바일 공개 메뉴" className="grid gap-1 border-t border-border px-5 py-4 lg:hidden">
          {PUBLIC_NAV.map(item => <Button key={item.to} asChild variant="ghost" className={`justify-start rounded-xl hover:bg-muted hover:text-primary ${CONTROL_MOTION}`}><NavLink to={item.to}>{item.label}</NavLink></Button>)}
          <Button asChild variant="ghost" className={`justify-start hover:bg-muted hover:text-primary ${CONTROL_MOTION}`}><Link to="/login">로그인</Link></Button>
        </nav>}
      </header>
      <main id="main-content" className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 sm:px-8 lg:px-12">
        <PageTransition />
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 px-5 py-7 text-xs sm:flex-row sm:items-center sm:px-8 lg:px-12">
          <span className="font-semibold tracking-[0.12em]">{BEFORE_US.brand.english}</span>
          <span className="text-muted-foreground">{BEFORE_US.brand.message}</span>
          <span className="text-muted-foreground">성인 대상 일대일 소개</span>
        </div>
      </footer>
    </div>
  );
}

function MemberShell({ isDark, toggle }: { isDark: boolean; toggle: () => void }) {
  const location = useLocation();
  const current = MEMBER_NAV.find(item => item.to === location.pathname || (item.to === "/meeting" && location.pathname === "/meeting/contact"));
  const memberPath = (to: string) => new URLSearchParams(location.search).get("demo") === "agreement" && ["/today", "/us", "/exchange", "/meeting", "/profile", "/payments", "/support"].includes(to) ? `${to}?demo=agreement` : to;
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="sticky top-0 hidden h-dvh w-[200px] shrink-0 flex-col border-r border-border bg-card px-4 py-8 md:flex">
        <div className="px-2"><Brand compact /></div>
        <nav aria-label="회원 메뉴" className="mt-16 grid gap-2">
          {MEMBER_NAV.map(({ to, label, icon: Icon }) => <NavLink key={to} to={memberPath(to)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring ${CONTROL_MOTION} ${isActive ? "bg-primary/8 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon size={18} strokeWidth={1.6} />{label}</NavLink>)}
        </nav>
        <div className="mt-auto border-t border-border pt-5">
          <span className="block px-4 pb-3 text-xs text-muted-foreground">데모 둘러보기</span>
          <Button asChild variant="ghost" className={`w-full justify-start gap-3 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground ${CONTROL_MOTION}`}><Link to="/"><LogOut size={16} />공개 홈으로</Link></Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-24 md:pb-0">
        <header className="border-b border-border">
          <div className="mx-auto flex h-20 max-w-[1120px] items-center justify-between px-5 sm:px-8 lg:px-10">
            <div className="md:hidden"><Brand compact /></div>
            <div className="hidden items-center gap-3 text-xs md:flex"><span className="text-muted-foreground">{BEFORE_US.brand.name}</span><span className="text-border">/</span><span>{current?.label}</span></div>
            <div className="flex items-center gap-3"><span className="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground">둘러보기</span><ShellThemeToggle isDark={isDark} toggle={toggle} /></div>
          </div>
        </header>
        <main id="main-content" className="mx-auto w-full max-w-[1120px] flex-1 px-5 py-10 sm:px-8 lg:px-10 lg:py-14"><PageTransition /></main>
      </div>
      <nav aria-label="모바일 회원 메뉴" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
        {MEMBER_NAV.map(({ to, label, icon: Icon }) => <NavLink key={to} to={memberPath(to)} className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-lg text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${CONTROL_MOTION} ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}><Icon size={20} strokeWidth={1.6} />{label}</NavLink>)}
      </nav>
    </div>
  );
}

function ContentFrame({ title, publicHome = false }: { title: string; publicHome?: boolean }) {
  return (
    <section aria-label={title} className={`flex flex-1 flex-col ${publicHome ? "py-12 sm:py-16" : ""}`}>
      <div className="flex items-end justify-between gap-5 border-b border-border pb-7">
        <div><p className="mb-3 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">{BEFORE_US.brand.english}</p><h1 className="text-3xl font-semibold leading-snug sm:text-4xl">{title}</h1></div>
        <span aria-hidden="true" className="mb-1 flex gap-2"><span className="size-2 rounded-full bg-primary" /><span className="size-2 rounded-full bg-accent" /></span>
      </div>
      <div className="flex min-h-80 flex-1 items-center justify-center py-20 sm:min-h-96" aria-hidden="true">
        <div className="flex items-center gap-5 opacity-10"><span className="size-20 rounded-full border border-primary sm:size-28" /><span className="size-20 rounded-full border border-accent sm:size-28" /></div>
      </div>
    </section>
  );
}

function AccessFrame({ application = false }: { application?: boolean }) {
  return (
    <section className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-16 sm:py-24">
      <p className="mb-5 text-xs font-semibold tracking-[0.15em] text-accent">{BEFORE_US.brand.english}</p>
      <h1 className="text-3xl font-semibold">{application ? "소개 신청하기" : "로그인"}</h1>
      <div className="mt-8 rounded-2xl border border-border bg-muted p-7">
        <p className="text-base font-semibold">지금은 데모로 둘러볼 수 있어요.</p>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">실제 계정 생성, 소개 신청과 결제는 진행되지 않습니다.</p>
        {!application && <p className="mt-3 text-xs leading-7 text-muted-foreground">계정 단계에는 사진이나 이상형 입력이 없습니다. 소개 신청은 별도의 4단계로 진행합니다.</p>}
        <Button asChild className={`mt-7 h-12 w-full rounded-xl ${CONTROL_MOTION}`}><Link to="/today">회원 공간 둘러보기 <ArrowRight size={16} /></Link></Button>
      </div>
      <Link to="/" className={`mt-6 w-fit rounded-sm text-sm text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring ${CONTROL_MOTION}`}>공개 홈으로 돌아가기</Link>
    </section>
  );
}

function MissingFrame() {
  return <section className="py-24"><h1 className="text-3xl font-semibold">페이지를 찾을 수 없어요.</h1><Button asChild className="mt-8 rounded-full"><Link to="/">공개 홈으로</Link></Button></section>;
}

function BeforeUsRoot() {
  const [isDark, setIsDark] = useState(false);
  const location = useLocation();
  const isMember = ["/payments","/support","/meeting/contact"].includes(location.pathname) || MEMBER_NAV.some(item => item.to === location.pathname);
  useEffect(() => {
    const label = [...PUBLIC_NAV, ...MEMBER_NAV, { to: "/login", label: "로그인" }, { to: "/apply", label: "소개 신청하기" }].find(item => item.to === location.pathname)?.label;
    document.title = label ? `${label} · ${BEFORE_US.brand.name}` : `${BEFORE_US.brand.name} · ${BEFORE_US.brand.english}`;
  }, [location.pathname]);
  return (
    <div className={isDark ? "dark font-sans" : "font-sans"}>
      <a href="#main-content" className="fixed top-3 left-3 z-50 -translate-y-24 rounded-xl bg-primary px-5 py-3 text-sm text-primary-foreground focus:translate-y-0">본문으로 건너뛰기</a>
      {isMember ? <MemberShell isDark={isDark} toggle={() => setIsDark(value => !value)} /> : <PublicShell isDark={isDark} toggle={() => setIsDark(value => !value)} />}
    </div>
  );
}

const beforeUsRouter = createBrowserRouter([
  { path: "/admin", element: <AdminLayout />, children: [
    { index: true, element: <AdminDashboard /> },
    ...(["applicants", "members", "introductions", "exchange"] as const).map(section => ({ path: section, element: <AdminOperations section={section} /> })),
    { path: "meetings", element: <AdminList section="meetings" /> },
    ...["payments", "safety", "reviews", "notifications", "audit", "settings", "analytics"].map(section => ({ path: section, element: <AdminGovernance key={section} section={section} /> })),
    { path: "matching", element: <AdminDemo embedded /> },
    { path: "*", element: <AdminList section="unknown" /> },
  ] },
  { path: "/demo/admin", element: <AdminDemo /> },
  { Component: BeforeUsRoot, children: [
    { index: true, element: <PublicHome /> },
    { path: "/how-it-works", element: <PublicInformation section="introduction" /> },
    { path: "/two-starts", element: <PublicInformation section="exchange" /> },
    { path: "/pricing", element: <PublicInformation section="pricing" /> },
    { path: "/today", element: <MemberToday /> },
    { path: "/payments", element: <MemberPayments /> },
    { path: "/us", element: <MemberIntroduction /> },
    { path: "/demo/introduction", element: <IntroductionDemo /> },
    { path: "/demo/noon", element: <NoonDemo /> },
    { path: "/demo/agreement", element: <AgreementDemo /> },
    { path: "/demo/letters", element: <LetterDemo /> },
    { path: "/demo/scene", element: <SceneDemo /> },
    { path: "/demo/meeting", element: <MeetingDemo /> },
    { path: "/demo/conduct", element: <ConductDemo /> },
    { path: "/exchange", element: <MemberAgreement /> },
    { path: "/demo/payments", element: <PaymentDemo /> },
    { path: "/meeting", element: <MemberMeeting /> },
    { path: "/meeting/contact", element: <MemberMeeting contactOnly /> },
    { path: "/profile", element: <MemberProfile /> },
    { path: "/support", element: <MemberSupport /> },
    ...MEMBER_NAV.filter(item => !["/today", "/meeting", "/us", "/exchange", "/profile"].includes(item.to)).map(item => ({ path: item.to, element: <ContentFrame title={item.label} /> })),
    { path: "/demo/today", element: <TodayDemo /> },
    { path: "/demo/photos", element: <PhotoDemo /> },
    { path: "/login", element: <AccessFrame /> },
    { path: "/apply", element: <ApplicationForm /> },
    { path: "*", element: <MissingFrame /> },
  ] },
]);

export default function App() {
  return <RouterProvider router={beforeUsRouter} />;
}
