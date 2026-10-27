import { useEffect, useState } from 'react';
import { resolveApiBase } from './lib/apiBase';
import { DEMO_CODE, DEMO_INVITE_CODE, demoModeEnabled, demoRequest, resetDemo, setDemoMode } from './lib/demo';
import {
  isAdult,
  validateAftercarePlan,
  validateBooking,
  validateContract,
  validateDuty,
  validateMessage,
  validateNote,
  validateProfile,
  validateProofNote,
  validateRating,
  type PetType,
  type Role,
} from './lib/validation';

type View = 'landing' | 'auth' | 'profile' | 'dashboard' | 'policy' | 'exit';
type MeetingMode = 'Online' | 'InPerson' | 'Both';
type Trust = { mutualRaterCount: number; averageScore: number | null; badge: string | null };
type Profile = {
  id: string;
  userId: string;
  displayName: string;
  role: Role;
  petType: PetType | null;
  meetingMode: MeetingMode;
  region: string | null;
  trust?: Trust;
};
type Thread = {
  partnerUserId: string;
  partnerProfile: Profile | null;
  lastMessage: { body: string; senderUserId: string };
  unreadCount: number;
};
type QueueReport = {
  id: string;
  category: string;
  details: string;
  urgent: boolean;
  status: string;
  reportedProfile: Profile | null;
  reporterProfile: Profile | null;
};
type Contract = {
  id: string;
  proposerUserId: string;
  partnerUserId: string;
  title: string;
  limits: string;
  safeword: string;
  status: string;
  signedUserIds: string[];
  resumeUserIds: string[];
};
type Duty = {
  id: string;
  contractId: string;
  assignedToUserId: string;
  title: string;
  description: string;
  status: string;
  proofNote: string;
  reviewNote: string;
};
type Booking = {
  id: string;
  proposerUserId: string;
  startAt: number;
  endAt: number;
  meetingMode: MeetingMode;
  region: string | null;
  workDescription: string;
  status: string;
};
type AftercarePlan = { id: string; closurePhrase: string; selfCarePrompts: string[]; checkInMinutes: number };
type AftercareCheckin = { id: string; kind: string; note: string; dueAt: number; completedAt: number | null };
type VideoHello = { id: string; requesterUserId: string; recipientUserId: string; message: string; status: string };
type ScheduledCheckin = { id: string; creatorUserId: string; recipientUserId: string; note: string; dueAt: number; completedAt: number | null };
type OwnerCommand = { id: string; senderUserId: string; recipientUserId: string; kind: string; note: string; status: string };
type RoutineItem = { id: string; date: string; label: string; status: string };
type WishlistItem = { id: string; label: string; category: string; note: string; shared: boolean };
type LostAlert = { id: string; contractId: string; petUserId: string; ownerUserId: string; petDisplayName: string; petType: string | null; generalArea: string; createdAt: number; reward: string; soundEnabled: boolean };
type PraiseNote = { id: string; senderUserId: string; recipientUserId: string; kind: string; text: string };
type Sitting = { id: string; baseContractId: string; ownerUserId: string; petUserId: string; sitterUserId: string | null; status: string; startsAt: number; endsAt: number; routineSummary: string; limits: string; safewordNote: string; agreedUserIds: string[]; notes: { userId: string; text: string; createdAt: number }[]; handoverReport: string; badgeAwarded: boolean; endedReason: string | null };
const REWARD_LINES: Record<string, string> = {
  badge: 'a Good Finder badge/sticker in-app',
  'thank-you': 'a thank-you note in-app',
  treat: 'a treat for the finder\'s own pet',
  'wishlist-gift': 'a wishlist gift between people who already know each other',
};

async function api(path: string, token: string | null, body?: unknown, method?: string) {
  if (demoModeEnabled()) {
    return demoRequest(path, method ?? (body ? 'POST' : 'GET'), body);
  }
  const base = resolveApiBase(import.meta.env.VITE_API_URL);
  const res = await fetch(`${base}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: method ?? (body ? 'POST' : 'GET'),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Request failed');
  return data as Record<string, unknown>;
}

export default function App() {
  const [view, setView] = useState<View>('landing');
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('dd_token'));
  const [demoMode, setDemoModeState] = useState<boolean>(() => demoModeEnabled());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState('');

  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('Pet');
  const [petType, setPetType] = useState<PetType>('Kitty');
  const [meetingMode, setMeetingMode] = useState<MeetingMode>('Both');
  const [region, setRegion] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isModerator, setIsModerator] = useState(false);
  const [filterRole, setFilterRole] = useState('');
  const [filterPetType, setFilterPetType] = useState('');
  const [filterMeetingMode, setFilterMeetingMode] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [likedUserIds, setLikedUserIds] = useState<Set<string>>(new Set());
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadUserId, setActiveThreadUserId] = useState('');
  const [threadMessages, setThreadMessages] = useState<{ body: string; senderUserId: string }[]>([]);
  const [messageBody, setMessageBody] = useState('');
  const [rateUserId, setRateUserId] = useState('');
  const [rateScore, setRateScore] = useState(5);
  const [rateNote, setRateNote] = useState('');
  const [queue, setQueue] = useState<QueueReport[]>([]);
  const [reportUserId, setReportUserId] = useState('');
  const [reportCategory, setReportCategory] = useState('other');
  const [reportDetails, setReportDetails] = useState('');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [contractPartnerUserId, setContractPartnerUserId] = useState('');
  const [contractTitle, setContractTitle] = useState('');
  const [contractLimits, setContractLimits] = useState('');
  const [contractSafeword, setContractSafeword] = useState('');
  const [duties, setDuties] = useState<Duty[]>([]);
  const [dutyTitle, setDutyTitle] = useState('');
  const [dutyDescription, setDutyDescription] = useState('');
  const [dutyAssigneeUserId, setDutyAssigneeUserId] = useState('');
  const [proofNote, setProofNote] = useState('');
  const [rewardTitle, setRewardTitle] = useState('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingStart, setBookingStart] = useState('');
  const [bookingEnd, setBookingEnd] = useState('');
  const [bookingMeetingMode, setBookingMeetingMode] = useState<MeetingMode>('Both');
  const [bookingRegion, setBookingRegion] = useState('');
  const [bookingWork, setBookingWork] = useState('');
  const [plans, setPlans] = useState<AftercarePlan[]>([]);
  const [planPhrase, setPlanPhrase] = useState('scene over, welcome back');
  const [planPrompts, setPlanPrompts] = useState('Get water\nGrab a blanket\nRest a little');
  const [planMinutes, setPlanMinutes] = useState(60);
  const [aftercareCheckins, setAftercareCheckins] = useState<AftercareCheckin[]>([]);
  const [checkinKind, setCheckinKind] = useState('prompt');
  const [checkinNote, setCheckinNote] = useState('');
  const [hellos, setHellos] = useState<VideoHello[]>([]);
  const [helloMessage, setHelloMessage] = useState('');
  const [schedCheckins, setSchedCheckins] = useState<ScheduledCheckin[]>([]);
  const [schedDue, setSchedDue] = useState('');
  const [schedNote, setSchedNote] = useState('');

  // Phase 3: commands, routine, wishlist, lost mode, praise, den animation.
  const [denAnimation, setDenAnimation] = useState(false);
  const [denCue, setDenCue] = useState('');
  const [commands, setCommands] = useState<OwnerCommand[]>([]);
  const [commandKind, setCommandKind] = useState('Come home');
  const [commandNote, setCommandNote] = useState('');
  const [routineItems, setRoutineItems] = useState<RoutineItem[]>([]);
  const [routineDate, setRoutineDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>([]);
  const [sharedWishlist, setSharedWishlist] = useState<WishlistItem[]>([]);
  const [wishLabel, setWishLabel] = useState('');
  const [wishCategory, setWishCategory] = useState('collar');
  const [wishNote, setWishNote] = useState('');
  const [wishShared, setWishShared] = useState(false);
  const [lostAlerts, setLostAlerts] = useState<LostAlert[]>([]);
  const [lostArea, setLostArea] = useState('');
  const [lostReward, setLostReward] = useState('badge');
  const [gameArea, setGameArea] = useState('');
  const [myGameArea, setMyGameArea] = useState('');
  const [nearbyAlerts, setNearbyAlerts] = useState<LostAlert[]>([]);
  const [lostSoundServer, setLostSoundServer] = useState(true);
  const [lostOptIn, setLostOptIn] = useState(false);
  const [lostMessage, setLostMessage] = useState('');
  const [lostSoundOn, setLostSoundOn] = useState(() => localStorage.getItem('dd_lost_sound') === 'on');
  const [lostVolume, setLostVolume] = useState(() => Number(localStorage.getItem('dd_lost_volume') ?? '50'));
  const [praiseNotes, setPraiseNotes] = useState<PraiseNote[]>([]);
  const [praiseKind, setPraiseKind] = useState('praise');
  const [praiseText, setPraiseText] = useState('');
  const [sittings, setSittings] = useState<Sitting[]>([]);
  const [sitStart, setSitStart] = useState('');
  const [sitEnd, setSitEnd] = useState('');
  const [sitRoutine, setSitRoutine] = useState('');
  const [sitLimits, setSitLimits] = useState('');
  const [sitSafewordNote, setSitSafewordNote] = useState('');
  const [sitNote, setSitNote] = useState('');
  const [sitHandover, setSitHandover] = useState('');

  useEffect(() => {
    if (!token) return;
    api('/api/v1/profiles/me', token)
      .then((data) => {
        setProfile(data.profile as Profile | null);
        setView(data.profile ? 'dashboard' : 'profile');
      })
      .catch(() => {
        setToken(null);
        localStorage.removeItem('dd_token');
        setView('landing');
      });
  }, [token]);

  const loadDashboard = async () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (filterRole) params.set('role', filterRole);
    if (filterPetType) params.set('petType', filterPetType);
    if (filterMeetingMode) params.set('meetingMode', filterMeetingMode);
    if (filterRegion.trim()) params.set('region', filterRegion.trim());
    const query = params.toString();
    const list = (await api(`/api/v1/profiles${query ? `?${query}` : ''}`, token)) as { profiles: Profile[] };
    setProfiles(list.profiles);
    const me = (await api('/api/v1/profiles/me', token)) as { isModerator: boolean };
    setIsModerator(me.isModerator);
    const likes = (await api('/api/v1/likes', token)) as { likes: { likedUserId: string }[] };
    setLikedUserIds(new Set(likes.likes.map((l) => l.likedUserId)));
    const threadList = (await api('/api/v1/messages/threads', token)) as { threads: Thread[] };
    setThreads(threadList.threads);
    const contractList = (await api('/api/v1/contracts', token)) as { contracts: Contract[] };
    setContracts(contractList.contracts);
    if (contractList.contracts.length > 0 && !selectedContractId) {
      setSelectedContractId(contractList.contracts[0].id);
      await loadContractDetails(contractList.contracts[0].id);
    } else if (selectedContractId) {
      await loadContractDetails(selectedContractId);
    }
    if (me.isModerator) {
      const q = (await api('/api/v1/reports/queue', token)) as { reports: QueueReport[] };
      setQueue(q.reports);
    }
    setView('dashboard');
  };

  useEffect(() => {
    if (view === 'dashboard') void loadDashboard();
  }, [view]);

  const quickExit = () => {
    localStorage.removeItem('dd_token');
    setToken(null);
    setProfile(null);
    window.history.replaceState(null, '', '/');
    setView('exit');
  };

  const requestCode = async () => {
    setError('');
    setNotice('');
    if (!isAdult(dob)) {
      setError('You must be 18 or older to use Den & Desk.');
      return;
    }
    try {
      const data = await api('/api/v1/auth/request-code', null, {
        dateOfBirth: dob,
        email,
        inviteCode,
      });
      setCodeSent(true);
      if (typeof data.devCode === 'string') setDevCode(data.devCode);
      setNotice('Code requested. In a live deployment this arrives by email; in local development it may be shown below.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request a code.');
    }
  };

  const verifyCode = async () => {
    setError('');
    try {
      const data = await api('/api/v1/auth/verify-code', null, { code, email });
      const nextToken = data.token as string;
      localStorage.setItem('dd_token', nextToken);
      setToken(nextToken);
      const nextProfile = (data.profile as Profile | null) ?? null;
      setProfile(nextProfile);
      // Phase 3 den-door animation on successful login: a short door
      // opening, under a second, no sound by default, instant when
      // reduced motion is preferred. It stores nothing and changes
      // nothing about auth — it is a welcome cue, with a different
      // wording for Owner vs Pet.
      const cue =
        nextProfile?.role === 'Owner'
          ? 'The Desk opens the Den.'
          : nextProfile?.role === 'Pet'
            ? 'Welcome home to the Den.'
            : 'The Den door opens.';
      setDenCue(cue);
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      if (reduced) {
        setView(nextProfile ? 'dashboard' : 'profile');
      } else {
        setDenAnimation(true);
        window.setTimeout(() => {
          setDenAnimation(false);
          setView(nextProfile ? 'dashboard' : 'profile');
        }, 900);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code verification failed.');
    }
  };

  const saveProfile = async () => {
    setError('');
    const problem = validateProfile({ displayName, petType, role });
    if (problem) {
      setError(problem);
      return;
    }
    try {
      const data = await api('/api/v1/profiles', token, {
        displayName,
        meetingMode,
        petType: role === 'Pet' ? petType : petType,
        region: region.trim() || null,
        role,
      });
      setProfile(data.profile as Profile);
      setView('dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile.');
    }
  };

  const blockUser = async (userId: string) => {
    if (!token) return;
    try {
      await api('/api/v1/blocks', token, { blockedUserId: userId });
      setNotice('That person is blocked. Blocking is always free.');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not block.');
    }
  };

  const submitReport = async () => {
    if (!token || !reportUserId) return;
    try {
      await api('/api/v1/reports', token, {
        category: reportCategory,
        details: reportDetails,
        reportedUserId: reportUserId,
      });
      setNotice('Report received. Safety reports are flagged urgent. Reporting is always free.');
      setReportDetails('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit report.');
    }
  };

  const likeUser = async (userId: string) => {
    if (!token) return;
    try {
      if (likedUserIds.has(userId)) {
        await api(`/api/v1/likes/${userId}`, token, undefined, 'DELETE');
      } else {
        await api('/api/v1/likes', token, { likedUserId: userId });
      }
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not like.');
    }
  };

  const passUser = async (userId: string) => {
    if (!token) return;
    try {
      await api('/api/v1/passes', token, { passedUserId: userId });
      setNotice('Passed. They will no longer appear in your discovery. Passing is not a block.');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pass.');
    }
  };

  const openThread = async (partnerUserId: string) => {
    if (!token) return;
    try {
      const data = (await api(`/api/v1/messages/threads/${partnerUserId}`, token)) as {
        messages: { body: string; senderUserId: string }[];
      };
      setActiveThreadUserId(partnerUserId);
      setThreadMessages(data.messages);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open messages.');
    }
  };

  const sendMessage = async () => {
    if (!token || !activeThreadUserId) return;
    const problem = validateMessage(messageBody);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await api('/api/v1/messages', token, { body: messageBody, recipientUserId: activeThreadUserId });
      setMessageBody('');
      await openThread(activeThreadUserId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message.');
    }
  };

  const submitRating = async () => {
    if (!token || !rateUserId) return;
    const problem = validateRating(rateScore, rateNote);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      const data = (await api('/api/v1/ratings', token, {
        note: rateNote.trim(),
        ratedUserId: rateUserId,
        score: rateScore,
      })) as { trust: Trust };
      setNotice(
        `Rating saved. Their trust badge is now: ${data.trust.badge ?? 'none yet — badges need mutual ratings.'}`,
      );
      setRateNote('');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save rating.');
    }
  };

  const resolveReport = async (reportId: string) => {
    if (!token) return;
    try {
      await api(`/api/v1/reports/${reportId}/resolve`, token);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve report.');
    }
  };

  const loadContractDetails = async (contractId: string) => {
    if (!token || !contractId) return;
    try {
      const d = (await api(`/api/v1/contracts/${contractId}/duties`, token)) as { duties: Duty[] };
      setDuties(d.duties);
      const b = (await api(`/api/v1/contracts/${contractId}/bookings`, token)) as { bookings: Booking[] };
      setBookings(b.bookings);
      const p = (await api(`/api/v1/contracts/${contractId}/aftercare/plans`, token)) as { plans: AftercarePlan[] };
      setPlans(p.plans);
      const ac = (await api(`/api/v1/contracts/${contractId}/aftercare/checkins`, token)) as { checkins: AftercareCheckin[] };
      setAftercareCheckins(ac.checkins);
      const h = (await api(`/api/v1/contracts/${contractId}/video-hellos`, token)) as { hellos: VideoHello[] };
      setHellos(h.hellos);
      const sc = (await api(`/api/v1/contracts/${contractId}/checkins`, token)) as { checkins: ScheduledCheckin[] };
      setSchedCheckins(sc.checkins);
      const cmd = (await api(`/api/v1/contracts/${contractId}/commands`, token)) as { commands: OwnerCommand[] };
      setCommands(cmd.commands);
      const pr = (await api(`/api/v1/contracts/${contractId}/praise`, token)) as { notes: PraiseNote[] };
      setPraiseNotes(pr.notes);
      const sw = (await api(`/api/v1/contracts/${contractId}/wishlist`, token)) as { items: WishlistItem[] };
      setSharedWishlist(sw.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load contract details.');
    }
  };

  const refreshContracts = async () => {
    if (!token) return;
    const list = (await api('/api/v1/contracts', token)) as { contracts: Contract[] };
    setContracts(list.contracts);
    if (selectedContractId) await loadContractDetails(selectedContractId);
  };

  const createContract = async () => {
    if (!token || !contractPartnerUserId) return;
    const problem = validateContract({ limits: contractLimits, safeword: contractSafeword, title: contractTitle });
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await api('/api/v1/contracts', token, {
        limits: contractLimits,
        partnerUserId: contractPartnerUserId,
        safeword: contractSafeword,
        title: contractTitle,
      });
      setNotice('Contract created as a draft. Both sides must sign before it becomes active.');
      await refreshContracts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create contract.');
    }
  };

  const contractAction = async (contractId: string, action: string) => {
    if (!token) return;
    try {
      await api(`/api/v1/contracts/${contractId}/${action}`, token);
      await refreshContracts();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} contract.`);
    }
  };

  const createDuty = async () => {
    if (!token || !selectedContractId || !dutyAssigneeUserId) return;
    const problem = validateDuty({ description: dutyDescription, title: dutyTitle });
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await api(`/api/v1/contracts/${selectedContractId}/duties`, token, {
        assignedToUserId: dutyAssigneeUserId,
        description: dutyDescription,
        title: dutyTitle,
      });
      await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create duty.');
    }
  };

  const dutyAction = async (dutyId: string, action: 'submit' | 'approve' | 'decline', extra?: Record<string, string>) => {
    if (!token) return;
    if (action === 'submit') {
      const problem = validateProofNote(proofNote);
      if (problem) {
        setError(problem);
        return;
      }
    }
    try {
      await api(`/api/v1/duties/${dutyId}/${action}`, token, extra);
      if (selectedContractId) await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} duty.`);
    }
  };

  const grantReward = async (dutyId: string) => {
    if (!token) return;
    if (!rewardTitle.trim()) {
      setError('Reward title is required.');
      return;
    }
    try {
      await api(`/api/v1/duties/${dutyId}/rewards`, token, { title: rewardTitle.trim() });
      setNotice('Reward granted for that approved duty.');
      if (selectedContractId) await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant reward.');
    }
  };

  const createBooking = async () => {
    if (!token || !selectedContractId) return;
    const startAt = new Date(bookingStart).getTime();
    const endAt = new Date(bookingEnd).getTime();
    const problem = validateBooking({ endAt, region: bookingRegion, startAt, workDescription: bookingWork });
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await api(`/api/v1/contracts/${selectedContractId}/bookings`, token, {
        endAt,
        meetingMode: bookingMeetingMode,
        region: bookingRegion.trim() || null,
        startAt,
        workDescription: bookingWork,
      });
      await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create booking.');
    }
  };

  const bookingAction = async (bookingId: string, action: 'confirm' | 'decline' | 'cancel') => {
    if (!token) return;
    try {
      await api(`/api/v1/bookings/${bookingId}/${action}`, token);
      if (selectedContractId) await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} booking.`);
    }
  };

  const createPlan = async () => {
    if (!token || !selectedContractId) return;
    const prompts = planPrompts.split('\n').map((p) => p.trim()).filter(Boolean);
    const problem = validateAftercarePlan({ checkInMinutes: planMinutes, closurePhrase: planPhrase, selfCarePrompts: prompts });
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await api(`/api/v1/contracts/${selectedContractId}/aftercare/plans`, token, {
        checkInMinutes: planMinutes,
        closurePhrase: planPhrase,
        selfCarePrompts: prompts,
      });
      await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create aftercare plan.');
    }
  };

  const createAftercareCheckin = async () => {
    if (!token || !selectedContractId) return;
    const problem = validateNote(checkinNote);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      const plansForContract = plans;
      await api(`/api/v1/contracts/${selectedContractId}/aftercare/checkins`, token, {
        kind: checkinKind,
        note: checkinNote,
        planId: plansForContract.length > 0 ? plansForContract[0].id : undefined,
      });
      await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create aftercare check-in.');
    }
  };

  const completeAftercareCheckin = async (checkinId: string) => {
    if (!token) return;
    try {
      await api(`/api/v1/aftercare/checkins/${checkinId}/complete`, token);
      if (selectedContractId) await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete check-in.');
    }
  };

  const requestHello = async () => {
    if (!token || !selectedContractId) return;
    const problem = validateNote(helloMessage);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await api(`/api/v1/contracts/${selectedContractId}/video-hellos`, token, { message: helloMessage });
      await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request a video hello.');
    }
  };

  const helloAction = async (helloId: string, action: 'accept' | 'decline' | 'complete') => {
    if (!token) return;
    try {
      await api(`/api/v1/video-hellos/${helloId}/${action}`, token);
      if (selectedContractId) await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} video hello.`);
    }
  };

  const createSchedCheckin = async () => {
    if (!token || !selectedContractId) return;
    const problem = validateNote(schedNote);
    if (problem) {
      setError(problem);
      return;
    }
    const dueAt = new Date(schedDue).getTime();
    if (!dueAt) {
      setError('A scheduled check-in needs a due time.');
      return;
    }
    try {
      await api(`/api/v1/contracts/${selectedContractId}/checkins`, token, { dueAt, note: schedNote });
      await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule a check-in.');
    }
  };

  const completeSchedCheckin = async (checkinId: string) => {
    if (!token) return;
    try {
      await api(`/api/v1/checkins/${checkinId}/complete`, token);
      if (selectedContractId) await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete check-in.');
    }
  };

  // ---- Phase 3 handlers ----
  const loadPhase3Personal = async () => {
    if (!token) return;
    try {
      const r = (await api(`/api/v1/routine?date=${routineDate}`, token)) as { items: RoutineItem[] };
      setRoutineItems(r.items);
      const w = (await api('/api/v1/wishlist', token)) as { items: WishlistItem[] };
      setWishlistItems(w.items);
      const l = (await api('/api/v1/lost', token)) as { alerts: LostAlert[] };
      setLostAlerts(l.alerts);
      const o = (await api('/api/v1/lost-opt-in', token)) as { enabled: boolean };
      setLostOptIn(o.enabled);
      const n = (await api('/api/v1/lost/nearby', token)) as { alerts: LostAlert[] };
      setNearbyAlerts(n.alerts);
      const s = (await api('/api/v1/lost-sound', token)) as { enabled: boolean };
      setLostSoundServer(s.enabled);
      const g = (await api('/api/v1/game-area', token)) as { area: string | null };
      setMyGameArea(g.area ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Phase 3 items.');
    }
  };

  const sendCommand = async () => {
    if (!token || !selectedContractId) return;
    try {
      await api(`/api/v1/contracts/${selectedContractId}/commands`, token, { kind: commandKind, note: commandNote });
      await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send command.');
    }
  };

  const respondCommand = async (commandId: string, status: string) => {
    if (!token) return;
    try {
      await api(`/api/v1/commands/${commandId}/respond`, token, { status });
      if (selectedContractId) await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer command.');
    }
  };

  const addRoutineItem = async (label: string) => {
    if (!token) return;
    try {
      await api('/api/v1/routine/items', token, { date: routineDate, label });
      await loadPhase3Personal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add routine item.');
    }
  };

  const respondRoutineItem = async (itemId: string, status: string) => {
    if (!token) return;
    try {
      await api(`/api/v1/routine/items/${itemId}/respond`, token, { status });
      await loadPhase3Personal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer routine item.');
    }
  };

  const addWishlistItem = async () => {
    if (!token || !wishLabel.trim()) return;
    try {
      await api('/api/v1/wishlist', token, { category: wishCategory, label: wishLabel.trim(), note: wishNote, shared: wishShared });
      await loadPhase3Personal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add wishlist item.');
    }
  };

  const toggleWishlistShare = async (item: WishlistItem) => {
    if (!token) return;
    try {
      await api(`/api/v1/wishlist/${item.id}`, token, { shared: !item.shared }, 'PATCH');
      await loadPhase3Personal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change wishlist sharing.');
    }
  };

  const removeWishlistItem = async (itemId: string) => {
    if (!token) return;
    try {
      await api(`/api/v1/wishlist/${itemId}`, token, undefined, 'DELETE');
      await loadPhase3Personal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove wishlist item.');
    }
  };

  const setLostOptInValue = async (enabled: boolean) => {
    if (!token) return;
    try {
      await api('/api/v1/lost-opt-in', token, { enabled });
      setLostOptIn(enabled);
      await loadPhase3Personal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change lost-game opt-in.');
    }
  };

  const createLostAlert = async () => {
    if (!token || !selectedContractId || !lostArea.trim()) return;
    try {
      await api(`/api/v1/contracts/${selectedContractId}/lost`, token, { generalArea: lostArea.trim(), reward: lostReward });
      setNotice('Lost mode is on. Only a general area is shown — never a street address or precise location.');
      await loadPhase3Personal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn on lost mode.');
    }
  };

  const lostAction = async (alertId: string, action: 'home' | 'off' | 'resolve' | 'found') => {
    if (!token) return;
    try {
      await api(`/api/v1/lost/${alertId}/${action}`, token);
      if (action === 'resolve') {
        const alert = lostAlerts.find((a) => a.id === alertId);
        setNotice(`Lost alert confirmed resolved in-app. Reward offered in-app: ${REWARD_LINES[alert?.reward ?? 'badge']}`);
      }
      if (action === 'found') {
        setNotice('Marked found in-app and messaged the original owner in-app only. No meeting, no following, no transport.');
      }
      await loadPhase3Personal();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} lost alert.`);
    }
  };

  const setLostSoundServerValue = async (enabled: boolean) => {
    if (!token) return;
    try {
      await api('/api/v1/lost-sound', token, { enabled });
      setLostSoundServer(enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change lost-game sound setting.');
    }
  };

  const checkIntoGameArea = async () => {
    if (!token || !gameArea.trim()) return;
    try {
      await api('/api/v1/game-area', token, { area: gameArea.trim() });
      setMyGameArea(gameArea.trim());
      await loadPhase3Personal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check into a play area.');
    }
  };

  // Finder proximity sound: plays only when the finder and the lost
  // pet are in the SAME in-game play area (both checked into the same
  // typed label, or the pet moved their game token there), the pet
  // has not muted the lost-game sound, the finder's own toggle is on,
  // and lost mode is on. Never real location, never real distance.
  const playFinderSound = (alert: LostAlert) => {
    if (!lostSoundOn || !alert.soundEnabled) return;
    if (!nearbyAlerts.some((a) => a.id === alert.id)) return;
    playLostSound();
  };

  const lostHelperMessage = async (alertId: string) => {
    if (!token || !lostMessage.trim()) return;
    try {
      await api(`/api/v1/lost/${alertId}/message`, token, { body: lostMessage.trim() });
      setNotice('Message sent to the original owner in-app. Do not meet anyone in person because of a lost alert.');
      await loadPhase3Personal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not message the owner about this lost alert.');
    }
  };

  const sendPraise = async () => {
    if (!token || !selectedContractId || !praiseText.trim()) return;
    try {
      await api(`/api/v1/contracts/${selectedContractId}/praise`, token, { kind: praiseKind, text: praiseText.trim() });
      await loadContractDetails(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send praise note.');
    }
  };

  const loadSittings = async () => {
    if (!token) return;
    try {
      const data = await api('/api/v1/sittings', token);
      setSittings(data.sittings as Sitting[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load sittings.');
    }
  };
  const createSitting = async () => {
    if (!token || !selectedContractId || !sitRoutine.trim() || !sitStart || !sitEnd) return;
    try {
      await api('/api/v1/sittings', token, { baseContractId: selectedContractId, endsAt: new Date(sitEnd).getTime(), limits: sitLimits, routineSummary: sitRoutine.trim(), safewordNote: sitSafewordNote, startsAt: new Date(sitStart).getTime() });
      await loadSittings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create sitting request.');
    }
  };
  const sittingAction = async (id: string, action: string, body?: unknown) => {
    if (!token) return;
    try {
      await api(`/api/v1/sittings/${id}/${action}`, token, body);
      await loadSittings();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} this sit.`);
    }
  };

  // Lost-game sound: opt-in, pet-controlled, in-app only, never
  // autoplayed and never proximity-triggered. It plays a short
  // synthesised notification tone through the device's own audio when
  // the pet presses Play, only while the pet has lost-game mode on,
  // and only when the sound toggle is on. Default is silent.
  const playLostSound = () => {
    if (!lostSoundOn) return;
    const myLost = lostAlerts.some((a) => a.petUserId === profile?.userId);
    if (!myLost) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.exponentialRampToValueAtTime(920, now + 0.15);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.4);
      gain.gain.setValueAtTime((lostVolume / 100) * 0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    } catch {
      // Sound is a game extra only; silence is always an acceptable fallback.
    }
  };

  if (view === 'exit') {
    return (
      <main>
        <h1>Local weather</h1>
        <p>Mostly cloudy, with a chance of rain later. Nothing to see here.</p>
        <p className="small">You left Den &amp; Desk quickly and your session was cleared from this browser.</p>
        <button onClick={() => setView('landing')}>Back to the start</button>
      </main>
    );
  }

  return (
    <main>
      {denAnimation && (
        <div className="den-door" role="status">
          <div className="den-door-panel">🚪 {denCue}</div>
        </div>
      )}
      <header className="topbar">
        <span className="brand">Den &amp; Desk</span>
        <button className="quick-exit" onClick={quickExit}>
          Quick exit
        </button>
      </header>

      {view === 'landing' && (
        <>
          <p>For consenting adults in roleplay.</p>
          <h1>Den &amp; Desk</h1>
          <p>
            A private, invite-only home for owner/pet pairs. Pets get a Den.
            Owners get a Desk. Everyone gets discovery, messaging, trust
            badges, and safety tools that stay free.
          </p>
          <div className="card">
            <h2>Join with an invite code</h2>
            <p className="small">
              No open registration in beta. No real name. No face photo
              required. No contact sync, ever. No Facebook login, ever.
            </p>
            <button onClick={() => setView('auth')}>Continue with email code</button>
            <button onClick={() => setView('policy')}>Read the policy</button>
          </div>
          <div className="card">
            <h2>Other sign-in options</h2>
            <p className="small">
              Sign in with Apple (private relay email) is planned as an
              optional extra and is not enabled in Phase 0.
            </p>
            <button className="planned" disabled>Sign in with Apple (not enabled yet)</button>
            <p className="small">Planned for later — intentionally inactive for now, not broken.</p>
            <p className="small">
              Warning: if you ever use Google, use a separate Google
              account if this identity is private — Google accounts are
              usually tied to a real identity.
            </p>
            <button className="planned" disabled>Sign in with Google (not enabled yet)</button>
            <p className="small">Planned for later — intentionally inactive for now, not broken.</p>
          </div>
          <div className="card demo-card">
            <h2>Test/dev demo — try it without a live service</h2>
            <p className="small">
              Testing only: this is not a real account. Demo data stays in
              this browser, is clearly marked as demo, and can be reset
              with one button. Nothing is sent anywhere in demo mode.
            </p>
            {demoMode ? (
              <>
                <p><strong>Demo mode is ON.</strong> Invite code: <strong>{DEMO_INVITE_CODE}</strong> · Demo login code: <strong>{DEMO_CODE}</strong></p>
                <button onClick={() => { resetDemo(); localStorage.removeItem('dd_token'); setToken(null); setProfile(null); setView('landing'); }}>Reset demo data</button>
                <button onClick={() => { setDemoMode(false); setDemoModeState(false); localStorage.removeItem('dd_token'); setToken(null); setProfile(null); setView('landing'); }}>Turn demo mode off</button>
              </>
            ) : (
              <button onClick={() => { setDemoMode(true); setDemoModeState(true); setView('landing'); }}>Turn on test/dev demo</button>
            )}
            {notice && <p>{notice}</p>}
          </div>
        </>
      )}

      {view === 'policy' && (
        <>
          <h1>Policy, plainly</h1>
          <p>Human pet roleplay is welcome: kitty, puppy, pony, hoods, tails, collars, fetch, and other roleplay between consenting adults.</p>
          <p>
            Bestiality — a real non-human animal as a sexual participant —
            is banned.
          </p>
          <p>
            Explicit content lives behind login and the invite gate only.
            No explicit imagery appears on public-facing pages. You can
            block anyone in one tap, report anyone, and leave quickly at
            any time. Blocking, reporting, safety, community, matching
            and messaging are free core, forever.
          </p>
          <button onClick={() => setView('landing')}>Back</button>
        </>
      )}

      {view === 'auth' && (
        <>
          <h1>Sign in with an email code</h1>
          <p className="small">No password to leak. Codes expire in 10 minutes.</p>
          {demoMode && (
            <p className="demo-banner"><strong>Demo mode is ON — testing only, not a real account.</strong> Use invite code <strong>{DEMO_INVITE_CODE}</strong> and demo code <strong>{DEMO_CODE}</strong>. Nothing is sent anywhere.</p>
          )}
          {error && <p className="error">{error}</p>}
          {notice && <p>{notice}</p>}
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </label>
          <label>
            Date of birth (you must be 18 or older)
            <input value={dob} onChange={(e) => setDob(e.target.value)} type="date" />
          </label>
          <label>
            Invite code (beta only, no open registration)
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          </label>
          <button onClick={requestCode}>Send code</button>
          {codeSent && (
            <>
              <label>
                6-digit code
                <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
              </label>
              {devCode && <p className="small">Development code (only because the API was started with ALLOW_DEV_CODE=true): {devCode}</p>}
              <button onClick={verifyCode}>Verify code</button>
            </>
          )}
          <button onClick={() => setView('landing')}>Back</button>
        </>
      )}

      {view === 'profile' && (
        <>
          <h1>Your pseudonymous profile</h1>
          {error && <p className="error">{error}</p>}
          <label>
            Display name (a pseudonym, never your real name)
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option>Owner</option>
              <option>Pet</option>
              <option>Switch</option>
              <option>Curious</option>
            </select>
          </label>
          <label>
            Pet type (Kitty / Puppy at launch)
            <select value={petType} onChange={(e) => setPetType(e.target.value as PetType)}>
              <option>Kitty</option>
              <option>Puppy</option>
            </select>
          </label>
          <label>
            How do you want to connect?
            <select value={meetingMode} onChange={(e) => setMeetingMode(e.target.value as MeetingMode)}>
              <option value="Online">Online only</option>
              <option value="InPerson">In person only</option>
              <option value="Both">Both</option>
            </select>
          </label>
          <label>
            Region (optional, a general area only — never a street address)
            <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Tri-Cities BC" />
          </label>
          <button onClick={saveProfile}>Save profile</button>
        </>
      )}

      {view === 'dashboard' && profile && (
        <>
          <h1>{profile.role === 'Pet' ? 'Welcome to your Den' : profile.role === 'Owner' ? 'Welcome to your Desk' : 'Welcome'}</h1>
          <p>
            {profile.displayName} · {profile.role}
            {profile.petType ? ` · ${profile.petType}` : ''}
          </p>
          {demoMode && (
            <div className="demo-banner">
              <strong>DEMO MODE — test data only, stored in this browser.</strong> This is not a real account.
              <button onClick={() => { resetDemo(); localStorage.removeItem('dd_token'); setToken(null); setProfile(null); setView('landing'); }}>Reset demo data</button>
              <button onClick={() => { setDemoMode(false); setDemoModeState(false); localStorage.removeItem('dd_token'); setToken(null); setProfile(null); setView('landing'); }}>Exit demo</button>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {notice && <p>{notice}</p>}
          <div className="card">
            <h2>Discover people</h2>
            <p className="small">
              Filters are exact matches. Region matches part of the region
              label. Passed people are hidden from you; blocked people are
              hidden both ways. Only real, registered profiles appear here.
              No fake members are ever created.
            </p>
            <label>
              Role
              <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
                <option value="">Any role</option>
                <option>Owner</option>
                <option>Pet</option>
                <option>Switch</option>
                <option>Curious</option>
              </select>
            </label>
            <label>
              Pet type
              <select value={filterPetType} onChange={(e) => setFilterPetType(e.target.value)}>
                <option value="">Any pet type</option>
                <option>Kitty</option>
                <option>Puppy</option>
              </select>
            </label>
            <label>
              How they connect
              <select value={filterMeetingMode} onChange={(e) => setFilterMeetingMode(e.target.value)}>
                <option value="">Any</option>
                <option value="Online">Online only</option>
                <option value="InPerson">In person only</option>
                <option value="Both">Both</option>
              </select>
            </label>
            <label>
              Region
              <input value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)} placeholder="e.g. Coquitlam" />
            </label>
            <button onClick={() => void loadDashboard()}>Search</button>
            {profiles.length === 0 && <p>No other profiles match yet.</p>}
            {profiles.map((p) => (
              <div key={p.id}>
                <strong>{p.displayName}</strong> · {p.role}
                {p.petType ? ` · ${p.petType}` : ''} · {p.meetingMode}
                {p.region ? ` · ${p.region}` : ''}
                {p.trust?.badge ? ` · ${p.trust.badge}` : ''}
                <button onClick={() => void likeUser(p.userId)}>{likedUserIds.has(p.userId) ? 'Liked ✓' : 'Like'}</button>
                <button onClick={() => void passUser(p.userId)}>Pass</button>
                <button onClick={() => void openThread(p.userId)}>Message</button>
                <button onClick={() => blockUser(p.userId)}>Block</button>
              </div>
            ))}
          </div>
          <div className="card">
            <h2>Mailbox</h2>
            <p className="small">
              One fixed thread per person. Messaging is not match-gated:
              you can message any registered, non-blocked person, and
              likes only shape discovery. Messaging is always free.
            </p>
            {threads.length === 0 && <p>No messages yet.</p>}
            {threads.map((t) => (
              <div key={t.partnerUserId}>
                <button onClick={() => void openThread(t.partnerUserId)}>
                  {t.partnerProfile?.displayName ?? 'Someone'}
                  {t.unreadCount > 0 ? ` (${t.unreadCount} unread)` : ''}
                </button>
                <span className="small"> — {t.lastMessage.body.slice(0, 80)}</span>
              </div>
            ))}
            {activeThreadUserId && (
              <>
                <h3>Thread</h3>
                {threadMessages.map((m, i) => (
                  <p key={i}>
                    <strong>{m.senderUserId === profile.userId ? 'You' : 'Them'}:</strong> {m.body}
                  </p>
                ))}
                <label>
                  Message (max 2000 characters)
                  <textarea value={messageBody} onChange={(e) => setMessageBody(e.target.value)} />
                </label>
                <button onClick={() => void sendMessage()}>Send message</button>
              </>
            )}
          </div>
          <div className="card">
            <h2>Rate someone (mutual trust)</h2>
            <p className="small">
              A trust badge counts only when the other person rates you
              back. One rating per direction; rating again replaces it.
              Highly trusted needs 3 mutual raters averaging 4.5 or more;
              Trusted needs 2 averaging 4.0 or more; Newly trusted needs
              1 averaging 3.5 or more.
            </p>
            <label>
              Person
              <select value={rateUserId} onChange={(e) => setRateUserId(e.target.value)}>
                <option value="">Choose someone</option>
                {profiles.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Score (1 to 5)
              <select value={rateScore} onChange={(e) => setRateScore(Number(e.target.value))}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
              </select>
            </label>
            <label>
              Note (optional, max 200 characters)
              <input value={rateNote} onChange={(e) => setRateNote(e.target.value)} />
            </label>
            <button onClick={() => void submitRating()}>Save rating</button>
          </div>
          {isModerator && (
            <div className="card">
              <h2>Safety queue (moderators only)</h2>
              <p className="small">Urgent safety reports first. Resolving removes a report from this open queue.</p>
              {queue.length === 0 && <p>No open reports.</p>}
              {queue.map((r) => (
                <div key={r.id}>
                  <strong>{r.urgent ? 'URGENT · ' : ''}{r.category}</strong> — reported:{' '}
                  {r.reportedProfile?.displayName ?? 'unknown'} · by {r.reporterProfile?.displayName ?? 'unknown'}
                  {r.details ? ` — ${r.details}` : ''}
                  <button onClick={() => void resolveReport(r.id)}>Resolve</button>
                </div>
              ))}
            </div>
          )}
          <div className="card">
            <h2>Dynamics: contracts, duties, bookings, aftercare</h2>
            <p className="small">
              A contract starts as a draft and only becomes active when
              both sides sign it. A safeword stops it at once; resuming
              needs both sides to confirm, so one side cannot restart it
              alone. Ending a contract always works, even after a block.
              Proof check-ins are written notes describing the check-in —
              Phase 2 has no photo upload or storage, so it never claims
              a photo was uploaded. A video hello is a request only —
              no video call happens inside Den &amp; Desk.
            </p>
            <h3>New contract</h3>
            <label>
              Other party
              <select value={contractPartnerUserId} onChange={(e) => setContractPartnerUserId(e.target.value)}>
                <option value="">Choose someone</option>
                {profiles.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input value={contractTitle} onChange={(e) => setContractTitle(e.target.value)} />
            </label>
            <label>
              Limits (optional, max 2000 characters)
              <textarea value={contractLimits} onChange={(e) => setContractLimits(e.target.value)} />
            </label>
            <label>
              Safeword (both sides will know it)
              <input value={contractSafeword} onChange={(e) => setContractSafeword(e.target.value)} />
            </label>
            <button onClick={() => void createContract()}>Create draft contract</button>
            {contracts.map((c) => (
              <div key={c.id}>
                <strong>{c.title}</strong> · {c.status} · signed {c.signedUserIds.length}/2
                <button
                  onClick={() => {
                    setSelectedContractId(c.id);
                    void loadContractDetails(c.id);
                  }}
                >
                  Open
                </button>
                <button onClick={() => void contractAction(c.id, 'sign')}>Sign</button>
                <button onClick={() => void contractAction(c.id, 'safeword')}>Safeword: stop now</button>
                <button onClick={() => void contractAction(c.id, 'pause')}>Pause</button>
                <button onClick={() => void contractAction(c.id, 'resume')}>Confirm resume</button>
                <button onClick={() => void contractAction(c.id, 'end')}>End</button>
              </div>
            ))}
            {selectedContractId && (
              <>
                <h3>Duties (active contracts only)</h3>
                <label>
                  Assign to
                  <select value={dutyAssigneeUserId} onChange={(e) => setDutyAssigneeUserId(e.target.value)}>
                    <option value="">Choose someone</option>
                    {profiles.map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Duty title
                  <input value={dutyTitle} onChange={(e) => setDutyTitle(e.target.value)} />
                </label>
                <label>
                  Description
                  <textarea value={dutyDescription} onChange={(e) => setDutyDescription(e.target.value)} />
                </label>
                <button onClick={() => void createDuty()}>Add duty</button>
                <label>
                  Proof note for submitting a duty (written check-in, no photo upload in Phase 2)
                  <input value={proofNote} onChange={(e) => setProofNote(e.target.value)} />
                </label>
                <label>
                  Reward title for an approved duty
                  <input value={rewardTitle} onChange={(e) => setRewardTitle(e.target.value)} />
                </label>
                {duties.map((d) => (
                  <div key={d.id}>
                    <strong>{d.title}</strong> · {d.status}
                    {d.proofNote ? ` · proof: ${d.proofNote}` : ''}
                    {d.reviewNote ? ` · review: ${d.reviewNote}` : ''}
                    <button onClick={() => void dutyAction(d.id, 'submit', { proofNote })}>Submit proof</button>
                    <button onClick={() => void dutyAction(d.id, 'approve', {})}>Approve</button>
                    <button onClick={() => void dutyAction(d.id, 'decline', {})}>Decline</button>
                    <button onClick={() => void grantReward(d.id)}>Grant reward</button>
                  </div>
                ))}
                <h3>Bookings (general scheduling)</h3>
                <label>
                  Start
                  <input type="datetime-local" value={bookingStart} onChange={(e) => setBookingStart(e.target.value)} />
                </label>
                <label>
                  End
                  <input type="datetime-local" value={bookingEnd} onChange={(e) => setBookingEnd(e.target.value)} />
                </label>
                <label>
                  How
                  <select value={bookingMeetingMode} onChange={(e) => setBookingMeetingMode(e.target.value as MeetingMode)}>
                    <option value="Online">Online only</option>
                    <option value="InPerson">In person only</option>
                    <option value="Both">Both</option>
                  </select>
                </label>
                <label>
                  Region (general area only, never a street address)
                  <input value={bookingRegion} onChange={(e) => setBookingRegion(e.target.value)} />
                </label>
                <label>
                  Work description
                  <textarea value={bookingWork} onChange={(e) => setBookingWork(e.target.value)} />
                </label>
                <button onClick={() => void createBooking()}>Propose booking</button>
                {bookings.map((b) => (
                  <div key={b.id}>
                    {new Date(b.startAt).toLocaleString()} to {new Date(b.endAt).toLocaleString()} · {b.meetingMode} · {b.status}
                    {b.workDescription ? ` · ${b.workDescription}` : ''}
                    <button onClick={() => void bookingAction(b.id, 'confirm')}>Confirm</button>
                    <button onClick={() => void bookingAction(b.id, 'decline')}>Decline</button>
                    <button onClick={() => void bookingAction(b.id, 'cancel')}>Cancel</button>
                  </div>
                ))}
                <h3>Aftercare</h3>
                <label>
                  Closure phrase
                  <input value={planPhrase} onChange={(e) => setPlanPhrase(e.target.value)} />
                </label>
                <label>
                  Self-care prompts (one per line, up to 10)
                  <textarea value={planPrompts} onChange={(e) => setPlanPrompts(e.target.value)} />
                </label>
                <label>
                  Scheduled check-in delay (minutes, 0 to 1440)
                  <input type="number" value={planMinutes} onChange={(e) => setPlanMinutes(Number(e.target.value))} />
                </label>
                <button onClick={() => void createPlan()}>Save aftercare plan</button>
                {plans.map((p) => (
                  <div key={p.id}>
                    {p.closurePhrase} · check-in in {p.checkInMinutes} minutes · {p.selfCarePrompts.join(' · ')}
                  </div>
                ))}
                <label>
                  Aftercare check-in kind
                  <select value={checkinKind} onChange={(e) => setCheckinKind(e.target.value)}>
                    <option value="prompt">Prompt now</option>
                    <option value="scheduled">Scheduled (uses the first plan&apos;s delay, or 60 minutes)</option>
                  </select>
                </label>
                <label>
                  Check-in note
                  <input value={checkinNote} onChange={(e) => setCheckinNote(e.target.value)} />
                </label>
                <button onClick={() => void createAftercareCheckin()}>Add aftercare check-in</button>
                {aftercareCheckins.map((c) => (
                  <div key={c.id}>
                    {c.kind} · due {new Date(c.dueAt).toLocaleString()} · {c.completedAt ? 'completed' : 'open'}
                    {c.note ? ` · ${c.note}` : ''}
                    {!c.completedAt && <button onClick={() => void completeAftercareCheckin(c.id)}>Complete</button>}
                  </div>
                ))}
                <h3>Long-distance tools</h3>
                <label>
                  Video-hello message (request only — no call inside the app)
                  <input value={helloMessage} onChange={(e) => setHelloMessage(e.target.value)} />
                </label>
                <button onClick={() => void requestHello()}>Request video hello</button>
                {hellos.map((h) => (
                  <div key={h.id}>
                    {h.status}
                    {h.message ? ` · ${h.message}` : ''}
                    <button onClick={() => void helloAction(h.id, 'accept')}>Accept</button>
                    <button onClick={() => void helloAction(h.id, 'decline')}>Decline</button>
                    <button onClick={() => void helloAction(h.id, 'complete')}>Complete</button>
                  </div>
                ))}
                <label>
                  Scheduled check-in due time
                  <input type="datetime-local" value={schedDue} onChange={(e) => setSchedDue(e.target.value)} />
                </label>
                <label>
                  Scheduled check-in note
                  <input value={schedNote} onChange={(e) => setSchedNote(e.target.value)} />
                </label>
                <button onClick={() => void createSchedCheckin()}>Schedule check-in</button>
                {schedCheckins.map((c) => (
                  <div key={c.id}>
                    due {new Date(c.dueAt).toLocaleString()} · {c.completedAt ? 'completed' : 'open'}
                    {c.note ? ` · ${c.note}` : ''}
                    {!c.completedAt && <button onClick={() => void completeSchedCheckin(c.id)}>Complete</button>}
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="card">
            <h2>Phase 3: routine, commands, wishlist, lost mode, praise</h2>
            <button onClick={() => void loadPhase3Personal()}>Load Phase 3 items</button>
            <h3>Owner commands (active contract only)</h3>
            <p className="small">Cage time means cozy den / quiet time, never confinement punishment. A safeword, pause, block, or contract end always overrides a command.</p>
            <label>
              Command
              <select value={commandKind} onChange={(e) => setCommandKind(e.target.value)}>
                <option>Come home</option>
                <option>Bedtime</option>
                <option>Cage time</option>
                <option>Eat</option>
                <option>Walk</option>
                <option>Potty break</option>
              </select>
            </label>
            <label>
              Note (optional)
              <input value={commandNote} onChange={(e) => setCommandNote(e.target.value)} />
            </label>
            <button onClick={() => void sendCommand()}>Send command</button>
            {commands.map((c) => (
              <div key={c.id}>
                {c.kind} · {c.status}
                {c.note ? ` · ${c.note}` : ''}
                {c.recipientUserId === profile?.userId && c.status === 'sent' && (
                  <>
                    <button onClick={() => void respondCommand(c.id, 'done')}>Done</button>
                    <button onClick={() => void respondCommand(c.id, 'need-help')}>Need help</button>
                    <button onClick={() => void respondCommand(c.id, 'passed')}>Pass</button>
                  </>
                )}
              </div>
            ))}
            <h3>Daily pet-care routine (no streaks, Pass is excused)</h3>
            <label>
              Day
              <input type="date" value={routineDate} onChange={(e) => setRoutineDate(e.target.value)} />
            </label>
            {['Eat', 'Walk', 'Potty', 'Nap', 'Play'].map((label) => (
              <button key={label} onClick={() => void addRoutineItem(label)}>
                Add {label}
              </button>
            ))}
            {routineItems.map((r) => (
              <div key={r.id}>
                {r.label} · {r.status}
                {r.status === 'open' && (
                  <>
                    <button onClick={() => void respondRoutineItem(r.id, 'done')}>Done</button>
                    <button onClick={() => void respondRoutineItem(r.id, 'passed')}>Pass</button>
                  </>
                )}
              </div>
            ))}
            <h3>Gear wishlist (no purchases, no prices, no shop links)</h3>
            <p className="small">Private by default. Share an item only if you choose to, and only your contract partner can see shared items.</p>
            <label>
              Item
              <input value={wishLabel} onChange={(e) => setWishLabel(e.target.value)} />
            </label>
            <label>
              Category
              <select value={wishCategory} onChange={(e) => setWishCategory(e.target.value)}>
                <option value="collar">Collar</option>
                <option value="leash">Leash</option>
                <option value="outfit">Outfit</option>
                <option value="den">Den / cage</option>
                <option value="toy">Toy</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Note (optional)
              <input value={wishNote} onChange={(e) => setWishNote(e.target.value)} />
            </label>
            <label>
              <input type="checkbox" checked={wishShared} onChange={(e) => setWishShared(e.target.checked)} /> Share with my contract partner
            </label>
            <button onClick={() => void addWishlistItem()}>Add to wishlist</button>
            {wishlistItems.map((w) => (
              <div key={w.id}>
                {w.label} · {w.category} · {w.shared ? 'shared' : 'private'}
                {w.note ? ` · ${w.note}` : ''}
                <button onClick={() => void toggleWishlistShare(w)}>{w.shared ? 'Make private' : 'Share'}</button>
                <button onClick={() => void removeWishlistItem(w.id)}>Remove</button>
              </div>
            ))}
            <h3>Partner&apos;s shared wishlist</h3>
            {sharedWishlist.map((w) => (
              <div key={w.id}>
                {w.label} · {w.category}
                {w.note ? ` · ${w.note}` : ''}
              </div>
            ))}
            <h3>Lost pets — safe lost mode (adults 18+ only, opt-in)</h3>
            <p className="small">
              A pet&apos;s in-app tag shows pseudonym and pet type only — never a real name, phone, address, or precise location, and no QR or tag links to a real identity.
              Lost mode is separately opt-in by the pet: an owner can only start it when the pet has opted in, and the pet can end it instantly.
              No GPS, no real-time tracking, and no location is ever auto-detected.
            </p>
            <h4>Caught protocol — please read before helping</h4>
            <p className="small">
              DO: ask first in-app, respect the safeword instantly, stop if the pet is out of headspace or distressed, contact the original owner in-app first, and let the original owner confirm.
              DO NOT: follow, touch without consent, share a photo or location, approach a pet who is alone and distressed, or transport a person in a vehicle.
              &quot;Transported home&quot; here means only: a helper marks found in-app, the owner confirms, and the pet checks in as home. The original owner, or the pet themselves, is the only person who physically moves the pet, and only if already agreed separately.
            </p>
            <label>
              <input type="checkbox" checked={lostOptIn} onChange={(e) => void setLostOptInValue(e.target.checked)} /> I opt into lost-game mode (pet&apos;s own choice; turning this off closes my open lost alerts)
            </label>
            <label>
              General area for a lost alert (general area only, never a street address)
              <input value={lostArea} onChange={(e) => setLostArea(e.target.value)} />
            </label>
            <label>
              Reward on the poster (in-app only — never cash, never a payment, never real contact details)
              <select value={lostReward} onChange={(e) => setLostReward(e.target.value)}>
                <option value="badge">Good Finder badge/sticker</option>
                <option value="thank-you">Thank-you note</option>
                <option value="treat">Treat for the finder&apos;s own pet</option>
                <option value="wishlist-gift">Wishlist gift (people who already know each other)</option>
              </select>
            </label>
            <button onClick={() => void createLostAlert()}>I lost my pet / turn lost mode on</button>
            <label>
              <input type="checkbox" checked={lostSoundServer} onChange={(e) => void setLostSoundServerValue(e.target.checked)} /> Pet-controlled lost-game sound: on (I can mute this at any time)
            </label>
            <h4>In-app game board (stylised board, not a real map)</h4>
            <p className="small">Check into a play area by typing its label — for example &quot;Forest clearing&quot;. Moving your game token here is the only &quot;proximity&quot; in this game. Nothing here uses your real location.</p>
            <div className="game-board">
              <div>Your token: {myGameArea ? `🎮 in ${myGameArea}` : 'not checked into a play area yet'}</div>
              {nearbyAlerts.map((a) => (
                <div key={`board-${a.id}`}>🐾 {a.petDisplayName}&apos;s token is in this play area too</div>
              ))}
            </div>
            <label>
              Play-area label
              <input value={gameArea} onChange={(e) => setGameArea(e.target.value)} />
            </label>
            <button onClick={() => void checkIntoGameArea()}>Check into play area / move my game token</button>
            <h4>Lost pets in your play area (proximity sound)</h4>
            <p className="small">When a lost pet&apos;s token is in the same play area as yours, and the pet has not muted the sound, the finder sound button below plays the distinct app sound. It never plays from a real distance.</p>
            {nearbyAlerts.map((a) => (
              <div key={`nearby-${a.id}`} className="lost-poster">
                <strong>LOST — Please find my {a.petType === 'Puppy' ? 'dog' : 'cat'}</strong>
                <div>{a.petDisplayName} · {a.petType ?? 'Pet'} · {a.generalArea}</div>
                <div>Reward: {REWARD_LINES[a.reward] ?? REWARD_LINES.badge}</div>
                <button onClick={() => playFinderSound(a)} disabled={!lostSoundOn || !a.soundEnabled}>
                  Play finder sound (same play area only)
                </button>
              </div>
            ))}
            <h4>Lost-game sound (opt-in, in-app only, default silent)</h4>
            <p className="small">This sound never plays by itself, never plays in public by default, and is never triggered by location. Press Play only while your own lost mode is on.</p>
            <label>
              <input
                type="checkbox"
                checked={lostSoundOn}
                onChange={(e) => {
                  setLostSoundOn(e.target.checked);
                  localStorage.setItem('dd_lost_sound', e.target.checked ? 'on' : 'off');
                }}
              /> Lost-game sound on
            </label>
            <label>
              Volume
              <input
                type="range"
                min="0"
                max="100"
                value={lostVolume}
                onChange={(e) => {
                  setLostVolume(Number(e.target.value));
                  localStorage.setItem('dd_lost_volume', e.target.value);
                }}
              />
            </label>
            <button onClick={playLostSound} disabled={!lostSoundOn || !lostAlerts.some((a) => a.petUserId === profile?.userId)}>
              Play lost-game sound
            </button>
            {lostAlerts.map((a) => (
              <div key={a.id} className="lost-poster">
                <strong>LOST — Please find my {a.petType === 'Puppy' ? 'dog' : 'cat'}</strong>
                <div>{a.petDisplayName} · {a.petType ?? 'Pet'} · {a.generalArea}</div>
                <div>Reward: {REWARD_LINES[a.reward] ?? REWARD_LINES.badge}</div>
                <div className="small">Distinct app sound: {a.soundEnabled ? 'on (pet-controlled, mutable)' : 'muted by the pet'}</div>
                {a.petUserId === profile?.userId && (
                  <>
                    <button onClick={() => void lostAction(a.id, 'home')}>I am home</button>
                    <button onClick={() => void lostAction(a.id, 'off')}>Turn lost mode off</button>
                  </>
                )}
                {a.ownerUserId === profile?.userId && <button onClick={() => void lostAction(a.id, 'resolve')}>Mark resolved (owner confirms)</button>}
                {a.petUserId !== profile?.userId && a.ownerUserId !== profile?.userId && (
                  <button onClick={() => void lostAction(a.id, 'found')}>I think I found them (in-app message to the owner only — no meeting, no transport)</button>
                )}
              </div>
            ))}
            <label>
              Message to the original owner about a lost pet (in-app only — never share a location or phone, never arrange to meet in person)
              <input value={lostMessage} onChange={(e) => setLostMessage(e.target.value)} />
            </label>
            {lostAlerts.map((a) => (
              <div key={`msg-${a.id}`}>
                <button onClick={() => void lostHelperMessage(a.id)}>Message {a.petDisplayName}&apos;s owner</button>
              </div>
            ))}
            <h3>Praise (private between the pair)</h3>
            <p className="small">No public shaming, no financial punishment. Safeword, pause, and block still override everything.</p>
            <label>
              Kind
              <select value={praiseKind} onChange={(e) => setPraiseKind(e.target.value)}>
                <option value="praise">Praise</option>
                <option value="correction">Gentle correction</option>
              </select>
            </label>
            <label>
              Note
              <input value={praiseText} onChange={(e) => setPraiseText(e.target.value)} />
            </label>
            <button onClick={() => void sendPraise()}>Send praise note</button>
            {praiseNotes.map((p) => (
              <div key={p.id}>
                {p.kind} · {p.text}
              </div>
            ))}
          </div>
          <div className="card">
            <h2>Pet-sitting (test/dev only — bounded, temporary sits)</h2>
            <p className="small">A sit never transfers the main contract and never carries a home address or keys. Both the original owner and the pet must agree before a sit starts. The owner can reclaim instantly, the pet can pause or end instantly, and control returns automatically when the window ends. A sitter badge is only awarded after a completed sit with no safety report.</p>
            <button onClick={() => void loadSittings()}>Load sittings</button>
            <label>
              Sitting start
              <input type="datetime-local" value={sitStart} onChange={(e) => setSitStart(e.target.value)} />
            </label>
            <label>
              Sitting end
              <input type="datetime-local" value={sitEnd} onChange={(e) => setSitEnd(e.target.value)} />
            </label>
            <label>
              Routine summary
              <input value={sitRoutine} onChange={(e) => setSitRoutine(e.target.value)} />
            </label>
            <label>
              Limits
              <input value={sitLimits} onChange={(e) => setSitLimits(e.target.value)} />
            </label>
            <label>
              Safeword note
              <input value={sitSafewordNote} onChange={(e) => setSitSafewordNote(e.target.value)} />
            </label>
            <button onClick={() => void createSitting()}>Post sitting request (original owner, selected contract)</button>
            {sittings.map((sit) => (
              <div key={sit.id}>
                <div>{sit.status} · {new Date(sit.startsAt).toLocaleString()} to {new Date(sit.endsAt).toLocaleString()} · {sit.routineSummary}</div>
                <div className="small">Agreed: {sit.agreedUserIds.length} · Badge: {sit.badgeAwarded ? 'awarded' : 'not awarded'}{sit.handoverReport ? ` · Handover: ${sit.handoverReport}` : ''}</div>
                <button onClick={() => void sittingAction(sit.id, 'apply')}>Apply as sitter</button>
                <button onClick={() => void sittingAction(sit.id, 'agree')}>Agree (owner or pet)</button>
                <button onClick={() => void sittingAction(sit.id, 'pause')}>Pause (pet)</button>
                <button onClick={() => void sittingAction(sit.id, 'resume')}>Resume (pet)</button>
                <button onClick={() => void sittingAction(sit.id, 'reclaim')}>Reclaim (original owner)</button>
                <button onClick={() => void sittingAction(sit.id, 'end')}>End (pet or sitter)</button>
                <button onClick={() => void sittingAction(sit.id, 'commands', { kind: 'Eat' })}>Sitter command: Eat</button>
                <button onClick={() => void sittingAction(sit.id, 'routine-items', { label: 'Eat' })}>Sitter routine: Eat</button>
                <label>
                  Sit check-in note
                  <input value={sitNote} onChange={(e) => setSitNote(e.target.value)} />
                </label>
                <button onClick={() => void sittingAction(sit.id, 'checkins', { note: sitNote })}>Add check-in (sitter)</button>
                <label>
                  Handover report
                  <input value={sitHandover} onChange={(e) => setSitHandover(e.target.value)} />
                </label>
                <button onClick={() => void sittingAction(sit.id, 'handover', { report: sitHandover })}>Write handover (after end)</button>
                <button onClick={() => void sittingAction(sit.id, 'badge')}>Award sitter badge (original owner, clean sit only)</button>
              </div>
            ))}
          </div>
          <div className="card">
            <h2>Report someone</h2>
            <label>
              Person
              <select value={reportUserId} onChange={(e) => setReportUserId(e.target.value)}>
                <option value="">Choose someone</option>
                {profiles.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select value={reportCategory} onChange={(e) => setReportCategory(e.target.value)}>
                <option value="safety">Safety (flagged urgent)</option>
                <option value="harassment">Harassment</option>
                <option value="spam">Spam</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Details
              <textarea value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} />
            </label>
            <button onClick={submitReport}>Submit report</button>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('dd_token');
              setToken(null);
              setView('landing');
            }}
          >
            Sign out
          </button>
        </>
      )}
    </main>
  );
}
