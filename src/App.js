import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
  createUserWithEmailAndPassword, // Added for creating coach accounts
  signInWithEmailAndPassword,     // Added for coach login
  updatePassword,                 // Added for changing coach passwords
  reauthenticateWithCredential,   // Added for re-authentication before sensitive operations
  EmailAuthProvider,              // Added for credential creation
  deleteUser,
  updateEmail // Added this missing import
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  collection,
  query,
  onSnapshot,
  Timestamp,
  writeBatch,
  getDocs,
  deleteDoc
} from 'firebase/firestore';

// --- Helper Functions ---

/**
 * Formats a given phone number string into '###-###-####' format.
 * @param {string} value The raw phone number string.
 * @returns {string} The formatted phone number.
 */
const formatPhoneNumber = (value) => {
  if (!value) return value;
  const phoneNumber = value.replace(/[^\d]/g, ''); // Remove non-digits
  const phoneNumberLength = phoneNumber.length;

  if (phoneNumberLength < 4) return phoneNumber;
  if (phoneNumberLength < 7) {
    return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3)}`;
  }
  return `${phoneNumber.slice(0, 3)}-${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
};

/**
 * Formats a Date object into a string suitable for datetime-local input (YYYY-MM-DDTHH:mm).
 * @param {Date | Timestamp | null} dateInput The Date object or Firestore Timestamp.
 * @returns {string} The formatted date-time string, or empty string if input is null.
 */
const formatToDatetimeLocal = (dateInput) => {
    if (!dateInput) return '';
    let date;
    if (dateInput instanceof Timestamp) {
        date = dateInput.toDate();
    } else if (dateInput instanceof Date) {
        date = dateInput;
    } else {
        return '';
    }

    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
};


// --- Firebase Context ---
const FirebaseContext = createContext(null);

// --- Custom Hook for Firebase ---
const useFirebase = () => useContext(FirebaseContext);

// --- Auth Protection Component ---
const AuthProtection = ({ children }) => {
  const { userId, isAuthReady, db, auth } = useFirebase();

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="flex flex-col items-center p-6 bg-white rounded-lg shadow-md">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          <p className="mt-4 text-gray-700">Loading application...</p>
        </div>
      </div>
    );
  }

  return children;
};

// --- App Component ---
function App() {
  const [appMode, setAppMode] = useState('checkIn'); // 'checkIn' or 'coach'
  const [firebaseApp, setFirebaseApp] = useState(null);
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [athletes, setAthletes] = useState([]);
  const [coaches, setCoaches] = useState([]); // New state for coaches
  const [currentDailyCheckins, setCurrentDailyCheckins] = useState([]); // New state for current day's check-ins
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalCallback, setModalCallback] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false); // For prompt-like modals
  const [confirmModalConfig, setConfirmModalConfig] = useState({ message: '', onConfirm: null, onCancel: null, input: false, inputValue: '' });
  const [coachLoggedIn, setCoachLoggedIn] = useState(false); // New state: Is a coach currently logged in?
  const [currentCoachUser, setCurrentCoachUser] = useState(null); // Firebase Auth user object for the logged-in coach
  const [appId, setAppId] = useState(null); // Added appId state to hold the projectId


  // Initialize Firebase and Auth
  useEffect(() => {
    try {
      // --- START OF FIREBASE CONFIGURATION ---
      // This is where you insert your Firebase project's configuration.
      // The Canvas environment typically provides this via __app_id and __firebase_config,
      // but you can hardcode it here for direct setup or local testing.
      const myFirebaseConfig = {
        apiKey: "AIzaSyCCS1fFfmH4Y4tXn6Rv7w4baNYrz5VSFLg",
        authDomain: "gym-check-in-d1bf5.firebaseapp.com",
        projectId: "gym-check-in-d1bf5",
        storageBucket: "gym-check-in-d1bf5.firebasestorage.app",
        messagingSenderId: "667813844333",
        appId: "1:667813844333:web:84e6746664e0540c933664",
        measurementId: "G-K7WD5R8DDB"
      };

      const firebaseConfig = myFirebaseConfig;
      // For Firestore collection paths, we'll use the projectId from your config as a common app ID.
      // This ensures consistency when hardcoding the config.
      const configuredAppId = firebaseConfig.projectId; // Rename to avoid conflict with state variable
      setAppId(configuredAppId); // Set appId state
      // --- END OF FIREBASE CONFIGURATION ---

      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authentication = getAuth(app);

      setFirebaseApp(app);
      setDb(firestore);
      setAuth(authentication);

      const unsubscribe = onAuthStateChanged(authentication, async (user) => {
        if (user) {
          setUserId(user.uid);
          // Check if the user is a known coach from Firestore
          // Use the 'configuredAppId' derived from firebaseConfig.projectId for the path
          const coachDocData = coaches.find(coach => coach.firebaseUid === user.uid);
          if (coachDocData && coachDocData.isApproved) {
            setCoachLoggedIn(true);
            setCurrentCoachUser(user);
            console.log("App Component: Coach logged in:", coachDocData.name);
          } else {
            setCoachLoggedIn(false); // Not an approved coach or anonymous user
            setCurrentCoachUser(null);
            console.log("App Component: Authenticated as regular user or unapproved coach:", user.uid);
          }
        } else {
          try {
            // Since we are likely hardcoding for a specific project now,
            // we will sign in anonymously if no authenticated user exists.
            // __initial_auth_token is typically for Canvas runtime environments.
            await signInAnonymously(authentication);
            console.log("App Component: Signed in anonymously.");

          } catch (error) {
            console.error("App Component: Firebase Auth Error:", error);
            setModalMessage(`Authentication failed: ${error.message}. Please try again.`);
            setShowModal(true);
          }
        }
        setIsAuthReady(true);
      });

      return () => unsubscribe();
    } catch (error) {
      console.error("App Component: Firebase Initialization Error:", error);
      setModalMessage(`Failed to initialize Firebase: ${error.message}.`);
      setShowModal(true);
      setIsAuthReady(true); // Stop loading, show error
    }
  }, [coaches]); // Add coaches to dependency array to react to changes in coach data


  // Fetch/Seed Athletes
  useEffect(() => {
    if (db && userId && isAuthReady && appId) { // Add appId to dependencies
      // Use the 'appId' variable here which is consistent with the hardcoded config's projectId
      const athletesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/athletes`);
      const q = query(athletesCollectionRef);

      const unsubscribe = onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) {
          console.log("App Component: No athletes found, seeding initial data...");
          console.log(`App Component: Seeding athletes for path: artifacts/${appId}/users/${userId}/athletes`); // Diagnostic log
          await seedInitialData(db, userId); // Use appId from state
        } else {
          const fetchedAthletes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setAthletes(fetchedAthletes);
          console.log("App Component: Athletes loaded:", fetchedAthletes.length);
        }
      }, (error) => {
        console.error("App Component: Error fetching athletes:", error);
        setModalMessage(`Failed to fetch athletes: ${error.message}`);
        setShowModal(true);
      });

      return () => unsubscribe();
    }
  }, [db, userId, isAuthReady, appId]); // Add appId to dependencies

  // Fetch/Seed Coaches
  useEffect(() => {
    if (db && userId && isAuthReady && appId) { // Add appId to dependencies
      // Use the 'appId' variable here
      const coachesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/coaches`);
      const q = query(coachesCollectionRef);

      const unsubscribe = onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) {
          console.log("App Component: No coaches found, seeding initial coach data...");
          console.log(`App Component: Seeding coaches for path: artifacts/${appId}/users/${userId}/coaches`); // Diagnostic log
          await seedInitialCoachData(db, userId); // Use appId from state
        } else {
          const fetchedCoaches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setCoaches(fetchedCoaches);
          console.log("App Component: Coaches loaded:", fetchedCoaches.length);
        }
      }, (error) => {
        console.error("App Component: Error fetching coaches:", error);
        setModalMessage(`Failed to fetch coaches: ${error.message}`);
        setShowModal(true);
      });

      return () => unsubscribe();
    }
  }, [db, userId, isAuthReady, appId]); // Add appId to dependencies

  // Fetch Current Daily Check-ins
  useEffect(() => {
    if (db && userId && isAuthReady && appId) { // Add appId to dependencies
      // Use the 'appId' variable here
      const currentCheckinsRef = collection(db, `artifacts/${appId}/users/${userId}/current_daily_checkins`);
      const q = query(currentCheckinsRef);

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedCheckins = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setCurrentDailyCheckins(fetchedCheckins);
        console.log("App Component: Current daily check-ins loaded:", fetchedCheckins.length);
      }, (error) => {
        console.error("App Component: Error fetching current daily check-ins:", error);
        setModalMessage(`Failed to fetch current daily check-ins: ${error.message}`);
        setShowModal(true);
      });

      return () => unsubscribe();
    }
  }, [db, userId, isAuthReady, appId]); // Add appId to dependencies


  // Initial Data for Teams and Classes
  const teams = ['Sparkle Squad', 'Power Pumas', 'Victory Vipers', 'Cheer Comets'];
  const classes = ['Tumble Basics', 'Jump & Stunt Drills', 'Flexibility Fusion', 'Routine Polish'];

  // Dummy Athlete Data for Seeding (removed isCheckedIn and related fields)
  const dummyAthletes = [
    {
      name: 'Alice Smith',
      teams: ['Sparkle Squad'],
      classes: ['Tumble Basics', 'Flexibility Fusion'],
      skills: [
        { name: 'Back Handspring', status: 'Mastered' },
        { name: 'Toe Touch', status: 'Working On' },
      ],
      improvementAreas: 'Needs consistency in back handsprings.',
      coachNotes: [],
      parentName: 'Brenda Smith',
      parentPhone: '555-111-2222',
      parentEmail: 'brenda.s@example.com',
      emergencyContactName: 'David Smith',
      emergencyContactPhone: '555-111-3333',
      isApproved: true, // Existing athletes are approved by default
      addedByCoach: 'System', // Added by System during seeding
      profilePicture: null, // New field for profile picture
    },
    {
      name: 'Bob Johnson',
      teams: ['Power Pumas'],
      classes: ['Jump & Stunt Drills'],
      skills: [
        { name: 'Full Twist', status: 'Needs Improvement' },
        { name: 'Double Toe Touch', status: 'Not Started' },
      ],
      improvementAreas: 'Struggles with coordination in stunts.',
      coachNotes: [],
      parentName: 'Carol Johnson',
      parentPhone: '555-222-3333',
      parentEmail: 'carol.j@example.com',
      emergencyContactName: '',
      emergencyContactPhone: '',
      isApproved: true,
      addedByCoach: 'System',
      profilePicture: null, // New field for profile picture
    },
    {
      name: 'Charlie Brown',
      teams: ['Sparkle Squad', 'Cheer Comets'],
      classes: ['Tumble Basics'],
      skills: [
        { name: 'Standing Tuck', status: 'Working On' },
        { name: 'Pike Jump', status: 'Mastered' },
      ],
      improvementAreas: 'Needs more power in standing tuck for consistent landing.',
      coachNotes: [],
      parentName: 'Diana Brown',
      parentPhone: '555-333-4444',
      parentEmail: 'diana.b@example.com',
      emergencyContactName: 'Evan Brown',
      emergencyContactPhone: '555-333-5555',
      isApproved: true,
      addedByCoach: 'System',
      profilePicture: null, // New field for profile picture
    },
    {
      name: 'Dana White',
      teams: ['Victory Vipers'],
      classes: ['Routine Polish', 'Flexibility Fusion'],
      skills: [
        { name: 'Scorpion', status: 'Mastered' },
        { name: 'Switch Kick', status: 'Working On' },
      ],
      improvementAreas: 'Maintain height on switch kicks.',
      coachNotes: [],
      parentName: 'Frank White',
      parentPhone: '555-444-5555',
      parentEmail: 'frank.w@example.com',
      emergencyContactName: '',
      emergencyContactPhone: '',
      isApproved: true,
      addedByCoach: 'System',
      profilePicture: null, // New field for profile picture
    },
    {
      name: 'Eve Green',
      teams: ['Power Pumas'],
      classes: ['Jump & Stunt Drills'],
      skills: [
        { name: 'Basket Toss', status: 'Working On' },
        { name: 'Heel Stretch', status: 'Mastered' },
      ],
      improvementAreas: 'Needs to trust her bases more for stunts.',
      coachNotes: [],
      parentName: 'George Green',
      parentPhone: '555-555-6666',
      parentEmail: 'george.g@example.com',
      emergencyContactName: '',
      emergencyContactPhone: '',
      isApproved: true,
      addedByCoach: 'System',
      profilePicture: null, // New field for profile picture
    },
  ];

  // Dummy Coach Data for Seeding
  const dummyCoaches = [
    { name: 'Coach Alex', email: 'alex@example.com', phone: '555-001-0001', isApproved: true, teams: ['Sparkle Squad', 'Power Pumas'], classes: ['Tumble Basics'], firebaseUid: '' },
    { name: 'Coach Ben', email: 'ben@example.com', phone: '555-002-0002', isApproved: true, teams: ['Victory Vipers'], classes: ['Jump & Stunt Drills', 'Routine Polish'], firebaseUid: '', isSuperAdmin: false }, // Added isSuperAdmin
    { name: 'Coach Casey', email: 'casey@example.com', phone: '555-003-0003', isApproved: true, teams: ['Cheer Comets'], classes: ['Flexibility Fusion'], firebaseUid: '', isSuperAdmin: false },
    { name: 'Coach Dylan', email: 'dylan@example.com', phone: '555-004-0004', isApproved: true, teams: [], classes: [], firebaseUid: '', isSuperAdmin: false },
  ];

  // Function to seed initial athlete data
  const seedInitialData = async (db, currentUserId) => {
    const athletesCollectionRef = collection(db, `artifacts/${appId}/users/${currentUserId}/athletes`); // Use appId
    try {
      for (const athlete of dummyAthletes) {
        // Remove check-in specific fields from athlete seeding as they are now handled by daily check-ins
        const { isCheckedIn, lastCheckInType, lastCheckInEntity, lastCheckInTimestamp, ...athleteToSave } = athlete;
        await setDoc(doc(athletesCollectionRef, athlete.name.replace(/\s+/g, '-').toLowerCase()), athleteToSave);
      }
      console.log("App Component: Initial athlete data seeded successfully!");
    } catch (error) {
      console.error("App Component: Error seeding athlete data:", error);
      setModalMessage(`Failed to seed initial athlete data: ${error.message}`);
      setShowModal(true);
    }
  };

  // Function to seed initial coach data
  const seedInitialCoachData = async (db, currentUserId) => {
    const coachesCollectionRef = collection(db, `artifacts/${appId}/users/${currentUserId}/coaches`); // Use appId
    try {
      for (const coach of dummyCoaches) {
        // Explicitly set the ID when using setDoc for consistency with updateDoc later
        await setDoc(doc(coachesCollectionRef, coach.name.replace(/\s+/g, '-').toLowerCase()), coach);
      }
      console.log("App Component: Initial coach data seeded successfully!");
    } catch (error) {
      console.error("App Component: Error seeding coach data:", error);
      setModalMessage(`Failed to seed initial coach data: ${error.message}`);
      setShowModal(true);
    }
  };


  // Generic Modal Component for custom alerts
  const Modal = ({ message, onConfirm, onCancel, showCancel = false }) => {
    if (!showModal) return null;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full text-center">
          <p className="text-lg font-semibold text-gray-800 mb-4">{message}</p>
          <div className="flex justify-center space-x-4">
            <button
              onClick={() => {
                setShowModal(false);
                if (onConfirm) onConfirm();
              }}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-200"
            >
              OK
            </button>
            {showCancel && (
              <button
                onClick={() => {
                  setShowModal(false);
                  if (onCancel) onCancel();
                }}
                className="px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-200"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Confirmation/Input Modal Component
  const ConfirmModal = () => {
    if (!showConfirmModal) return null;

    const handleConfirm = () => {
      setShowConfirmModal(false);
      confirmModalConfig.onConfirm(confirmModalConfig.inputValue); // Pass input value if available
    };

    const handleCancel = () => {
      setShowConfirmModal(false);
      if (confirmModalConfig.onCancel) {
        confirmModalConfig.onCancel();
      }
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full text-center">
          <p className="text-lg font-semibold text-gray-800 mb-4">{confirmModalConfig.message}</p>
          {confirmModalConfig.input && (
            <input
              type="password" // Use password type for passcode
              value={confirmModalConfig.inputValue}
              onChange={(e) => setConfirmModalConfig(prev => ({ ...prev, inputValue: e.target.value }))}
              className="w-full p-2 border border-gray-300 rounded-md mb-4 text-center"
              placeholder="Enter passcode"
              autoFocus // Auto-focus the input field
            />
          )}
          <div className="flex justify-center space-x-4">
            <button
              onClick={handleConfirm}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-200"
            >
              Confirm
            </button>
            <button
              onClick={handleCancel}
              className="px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };


  const showCustomModal = (message, onConfirm, showCancel = false, onCancel = null) => {
    setModalMessage(message);
    setModalCallback(() => onConfirm);
    setShowModal(true);
  };

  const showConfirmWithInputModal = (message, onConfirm, onCancel, inputPlaceholder = '') => {
    setConfirmModalConfig({
      message,
      onConfirm: (inputValue) => onConfirm(inputValue),
      onCancel,
      input: true,
      inputValue: '',
      inputPlaceholder
    });
    setShowConfirmModal(true);
  };

  return (
    <FirebaseContext.Provider value={{ firebaseApp, db, auth, userId, isAuthReady, athletes, setAthletes, coaches, setCoaches, currentDailyCheckins, showCustomModal, showConfirmWithInputModal, coachLoggedIn, setCoachLoggedIn, currentCoachUser, appId }}> {/* Pass appId here */}
      <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-100 font-sans text-gray-900 flex flex-col">
        {/* Header and Mode Switcher */}
        <header className="bg-white shadow-md p-4 flex flex-col sm:flex-row items-center justify-between rounded-b-xl mx-2 mt-2">
          <h1 className="text-3xl font-extrabold text-blue-800 mb-2 sm:mb-0">Cheer Gym Portal</h1>
          <div className="flex space-x-4">
            <button
              onClick={() => setAppMode('checkIn')}
              className={`px-6 py-2 rounded-lg font-semibold transition duration-300 ease-in-out ${
                appMode === 'checkIn' ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-blue-100'
              }`}
            >
              Check-In
            </button>
            <button
              onClick={() => {
                setAppMode('coach');
                if (!coachLoggedIn) { // Only prompt login if not already logged in as a coach
                  // showCoachLoginModal(true); // Handled by CoachDashboard component
                }
              }}
              className={`px-6 py-2 rounded-lg font-semibold transition duration-300 ease-in-out ${
                appMode === 'coach' ? 'bg-purple-600 text-white shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-purple-100'
              }`}
            >
              Coach Dashboard
            </button>
          </div>
        </header>

        {/* User ID Display */}
        {userId && (
          <div className="bg-gray-700 text-white text-xs p-2 text-center rounded-b-lg mx-2 mb-2 shadow-inner">
            <p className="font-mono">User ID: <span className="font-bold">{userId}</span></p>
          </div>
        )}
        {currentCoachUser && (
            <div className="bg-purple-700 text-white text-xs p-2 text-center rounded-b-lg mx-2 mb-2 shadow-inner">
                <p className="font-mono">Logged in as Coach: <span className="font-bold">{currentCoachUser.email}</span></p>
            </div>
        )}

        {/* Main Content Area */}
        <main className="flex-grow p-4">
          <AuthProtection>
            {appMode === 'checkIn' ? (
              <CheckInPortal teams={teams} classes={classes} />
            ) : (
              <CoachDashboard teams={teams} classes={classes} />
            )}
          </AuthProtection>
        </main>

        <Modal
          message={modalMessage}
          onConfirm={modalCallback}
          showCancel={false} // For simple alerts, no cancel needed
        />
        <ConfirmModal />
      </div>
    </FirebaseContext.Provider>
  );
}

// --- CoachLoginModal Component ---
const CoachLoginModal = ({ onLoginSuccess, onCancel }) => {
  const { auth, showCustomModal } = useFirebase();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleLogin = async () => {
    if (!auth) {
      setErrorMessage("Firebase Auth not initialized.");
      return;
    }
    if (!email || !password) {
      setErrorMessage("Please enter both email and password.");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Auth state listener in App.js will handle setting coachLoggedIn
      onLoginSuccess();
    } catch (error) {
      console.error("Coach login error:", error);
      let msg = "Login failed. Invalid credentials.";
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        msg = "Invalid email or password.";
      } else if (error.code === 'auth/too-many-requests') {
        msg = "Too many login attempts. Please try again later.";
      }
      setErrorMessage(msg);
      showCustomModal(msg); // Show modal for persistent error message
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full text-center transform scale-105">
        <h3 className="text-3xl font-extrabold text-gray-800 mb-6">Coach Login</h3>
        {errorMessage && (
          <p className="text-red-600 text-sm mb-4">{errorMessage}</p>
        )}
        <div className="mb-4 text-left">
          <label htmlFor="coachEmail" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            id="coachEmail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-800"
            placeholder="coach@example.com"
          />
        </div>
        <div className="mb-6 text-left">
          <label htmlFor="coachPassword" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            type="password"
            id="coachPassword"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-800"
            placeholder="Password"
          />
        </div>
        <div className="flex flex-col space-y-3">
          <button
            onClick={handleLogin}
            className="w-full px-6 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition duration-300 ease-in-out shadow-md"
          >
            Login
          </button>
          <button
            onClick={onCancel}
            className="w-full px-6 py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition duration-300 ease-in-out"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};


// --- CheckInPortal Component ---
const CheckInPortal = ({ teams, classes }) => {
  const { db, userId, athletes, currentDailyCheckins, showCustomModal, appId } = useFirebase(); // Destructure appId
  const [selectedCategory, setSelectedCategory] = useState(null); // 'team' or 'class'
  const [selectedName, setSelectedName] = useState(null); // The specific team/class name
  const [filteredAthletes, setFilteredAthletes] = useState([]);
  const [checkInMessage, setCheckInMessage] = useState('');
  const checkInMessageTimeoutRef = useRef(null);

  // For hold-to-check-in functionality
  const [holdingAthleteId, setHoldingAthleteId] = useState(null);
  const [holdProgressMap, setHoldProgressMap] = useState({}); // Stores progress for each athlete {id: progress}
  const holdIntervalRefs = useRef({}); // Stores interval IDs for each athlete
  const CHECK_IN_HOLD_DURATION_SECONDS = 2;


  useEffect(() => {
    const currentApprovedAthletes = athletes.filter(athlete => athlete.isApproved);

    if (selectedCategory && selectedName) {
      const categoryKey = selectedCategory === 'team' ? 'teams' : 'classes';
      const filtered = currentApprovedAthletes.filter(athlete =>
        athlete[categoryKey] && athlete[categoryKey].includes(selectedName)
      ).sort((a, b) => a.name.localeCompare(b.name));
      setFilteredAthletes(filtered);
    } else {
      setFilteredAthletes([]);
    }
  }, [selectedCategory, selectedName, athletes]);


  const handleAthleteCheckIn = async (athleteId, athleteName) => {
    if (!db || !userId || !appId) { // Check for appId
      showCustomModal("Error: Database or App ID not ready for check-in.");
      return;
    }

    try {
      // Use the 'appId' variable here
      const currentCheckinsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/current_daily_checkins`);
      await setDoc(doc(currentCheckinsCollectionRef), { // Add new document for each check-in
        athleteId: athleteId,
        athleteName: athleteName,
        checkInType: selectedCategory,
        checkInEntity: selectedName,
        timestamp: Timestamp.now(),
      });
      console.log(`CheckInPortal: Athlete ${athleteName} checked in successfully!`);
      setCheckInMessage(`${athleteName} Checked In!`);

      // Clear any existing message timeout and set a new one
      if (checkInMessageTimeoutRef.current) {
        clearTimeout(checkInMessageTimeoutRef.current);
      }
      checkInMessageTimeoutRef.current = setTimeout(() => {
        setCheckInMessage('');
      }, 3000);

    } catch (error) {
      console.error("CheckInPortal: Error checking in athlete:", error);
      showCustomModal(`Failed to check in ${athleteName}: ${error.message}`);
    } finally {
      // Always reset hold state after attempt, successful or not
      handleAthleteRelease(athleteId);
    }
  };

  const handleAthleteMouseDown = (athleteId) => {
    if (holdingAthleteId === athleteId) return; // Already holding this one

    setHoldingAthleteId(athleteId);
    setHoldProgressMap(prev => ({ ...prev, [athleteId]: 0 }));

    holdIntervalRefs.current[athleteId] = setInterval(() => {
      setHoldProgressMap(prev => {
        const newProgress = (prev[athleteId] || 0) + 1;
        if (newProgress >= CHECK_IN_HOLD_DURATION_SECONDS) {
          clearInterval(holdIntervalRefs.current[athleteId]);
          delete holdIntervalRefs.current[athleteId];
          handleAthleteCheckIn(athleteId, filteredAthletes.find(a => a.id === athleteId)?.name);
          return { ...prev, [athleteId]: 0 }; // Reset progress for this athlete
        }
        return newProgress;
      });
    }, 1000); // Increment every second
  };

  const handleAthleteRelease = (athleteId) => {
    if (holdIntervalRefs.current[athleteId]) {
      clearInterval(holdIntervalRefs.current[athleteId]);
      delete holdIntervalRefs.current[athleteId];
    }
    setHoldingAthleteId(null); // Clear holding athlete
    setHoldProgressMap(prev => ({ ...prev, [athleteId]: 0 })); // Reset specific athlete's progress
  };


  const handleBack = () => {
    setSelectedCategory(null);
    setSelectedName(null);
    setCheckInMessage('');
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 max-w-4xl mx-auto min-h-[600px] flex flex-col">
      <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Athlete Check-In</h2>

      {checkInMessage && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg relative text-center mb-4 transition-all duration-300 ease-in-out">
          <p className="font-semibold">{checkInMessage}</p>
        </div>
      )}

      {!selectedCategory && (
        <>
          <p className="text-xl text-center text-gray-700 mb-6">Select your Team or Class:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 flex-grow">
            <div className="bg-blue-50 p-4 rounded-lg shadow-inner">
              <h3 className="text-2xl font-semibold text-blue-700 mb-4 text-center">Teams</h3>
              <div className="flex flex-wrap gap-3 justify-center">
                {teams.map(team => (
                  <button
                    key={team}
                    onClick={() => { setSelectedCategory('team'); setSelectedName(team); }}
                    className="flex-grow px-6 py-3 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transform hover:scale-105 transition duration-300 ease-in-out font-semibold text-lg"
                  >
                    {team}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg shadow-inner">
              <h3 className="text-2xl font-semibold text-purple-700 mb-4 text-center">Classes</h3>
              <div className="flex flex-wrap gap-3 justify-center">
                {classes.map(cls => (
                  <button
                    key={cls}
                    onClick={() => { setSelectedCategory('class'); setSelectedName(cls); }}
                    className="flex-grow px-6 py-3 bg-purple-600 text-white rounded-lg shadow-md hover:bg-purple-700 transform hover:scale-105 transition duration-300 ease-in-out font-semibold text-lg"
                  >
                    {cls}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {selectedCategory && selectedName && (
        <div className="flex flex-col flex-grow">
          <button
            onClick={handleBack}
            className="self-start mb-4 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition duration-200 flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 14.707a1 1 0 01-1.414 0L7.293 10.707a1 1 0 010-1.414l3.999-3.999a1 1 0 011.414 1.414L9.414 10l3.293 3.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Categories
          </button>
          <h3 className="text-2xl font-bold text-center text-gray-800 mb-6">{selectedName} Roster</h3>
          <p className="text-sm text-gray-600 text-center mb-4">Hold an athlete's name for {CHECK_IN_HOLD_DURATION_SECONDS} seconds to check them in.</p>
          {filteredAthletes.length === 0 ? (
            <p className="text-center text-gray-600 text-lg">No athletes assigned to this {selectedCategory} yet.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 overflow-y-auto flex-grow">
              {filteredAthletes.map(athlete => {
                const progress = holdProgressMap[athlete.id] || 0;
                const isHolding = holdingAthleteId === athlete.id;
                const progressWidth = (progress / CHECK_IN_HOLD_DURATION_SECONDS) * 100;

                // Check if athlete has checked in for the current selected category/entity today
                const hasCheckedInForThisEntity = currentDailyCheckins.some(
                  checkin => checkin.athleteId === athlete.id &&
                             checkin.checkInType === selectedCategory &&
                             checkin.checkInEntity === selectedName
                );

                return (
                  <li key={athlete.id} className="relative">
                    <button
                      onMouseDown={() => handleAthleteMouseDown(athlete.id)}
                      onMouseUp={() => handleAthleteRelease(athlete.id)}
                      onMouseLeave={() => handleAthleteRelease(athlete.id)}
                      onTouchStart={() => handleAthleteMouseDown(athlete.id)}
                      onTouchEnd={() => handleAthleteRelease(athlete.id)}
                      onTouchCancel={() => handleAthleteRelease(athlete.id)}
                      className={`relative w-full px-6 py-4 rounded-xl shadow-md text-center font-semibold text-xl transition-all duration-300 ease-in-out overflow-hidden
                        ${hasCheckedInForThisEntity
                          ? 'bg-green-500 text-white transform scale-105 shadow-lg'
                          : 'bg-indigo-500 text-white hover:bg-indigo-600 transform hover:scale-105'
                        }`}
                      // Button is always enabled to allow multiple check-ins
                    >
                      {isHolding && (
                        <div
                          className="absolute inset-0 bg-blue-400 opacity-50"
                          style={{ width: `${progressWidth}%`, transition: 'width 1s linear' }}
                        ></div>
                      )}
                      <span className="relative z-10">
                        {athlete.name}
                        {isHolding && progress > 0 && <span className="ml-2 text-sm">({CHECK_IN_HOLD_DURATION_SECONDS - progress}s)</span>}
                        {hasCheckedInForThisEntity && (
                          <span className="absolute top-2 right-2 text-green-800 bg-white rounded-full p-1 text-xs font-bold shadow-md">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// --- CoachDashboard Component ---
const CoachDashboard = ({ teams, classes }) => {
  const [coachView, setCoachView] = useState('roster'); // 'roster', 'profiles', 'management', 'checkinLogs'
  const { db, userId, athletes, currentDailyCheckins, showCustomModal, coachLoggedIn, setCoachLoggedIn, auth, currentCoachUser, appId } = useFirebase(); // Destructure appId

  const [isHoldingReset, setIsHoldingReset] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdIntervalRef = useRef(null);
  const RESET_HOLD_DURATION_SECONDS = 5;


  /**
   * Handles the start of the hold gesture for the reset button.
   */
  const handleResetMouseDown = () => {
    if (!db || !userId || !appId) { // Check appId
      showCustomModal("Database or App ID not ready to reset check-ins.");
      return;
    }

    setIsHoldingReset(true);
    setHoldProgress(0);

    // Start interval to increment progress
    holdIntervalRef.current = setInterval(() => {
      setHoldProgress(prev => {
        const newProgress = prev + 1;
        if (newProgress >= RESET_HOLD_DURATION_SECONDS) {
          clearInterval(holdIntervalRef.current);
          handleResetCheckIns(); // Trigger reset
          return 0; // Reset progress bar
        }
        return newProgress;
      });
    }, 1000); // Increment every second
  };

  /**
   * Handles the end of the hold gesture (mouse up or leave).
   */
  const handleResetMouseUp = () => {
    clearInterval(holdIntervalRef.current);
    setIsHoldingReset(false);
    setHoldProgress(0); // Reset progress if not fully held
  };

  /**
   * Logs current check-ins and resets all athletes' check-in status.
   */
  const handleResetCheckIns = async () => {
    if (!db || !userId || !appId) { // Check appId
      showCustomModal("Error: Database or App ID not ready for reset.");
      return;
    }

    try {
      // Use the 'appId' variable here
      const currentCheckinsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/current_daily_checkins`);
      const querySnapshot = await getDocs(query(currentCheckinsCollectionRef));
      const dailyCheckInEvents = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 2. Log these events into the checkin_logs historical collection
      // Use the 'appId' variable here
      const checkinLogRef = collection(db, `artifacts/${appId}/users/${userId}/checkin_logs`);
      await setDoc(doc(checkinLogRef), { // Let Firestore generate ID for the log entry
        timestamp: Timestamp.now(),
        resetByUserId: userId,
        dailyCheckInEvents: dailyCheckInEvents.map(event => ({ // Store only relevant event data
          athleteId: event.athleteId,
          athleteName: event.athleteName,
          checkInType: event.checkInType,
          checkInEntity: event.checkInEntity,
          timestamp: event.timestamp,
        }))
      });
      console.log("CoachDashboard: Current daily check-ins logged successfully.");

      // 3. Clear the current_daily_checkins collection using a batch delete
      const batch = writeBatch(db);
      querySnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log("CoachDashboard: Current daily check-ins cleared successfully!");

      showCustomModal("All daily check-ins have been reset and logged.");
    } catch (error) {
      console.error("CoachDashboard: Error resetting check-ins:", error);
      showCustomModal(`Failed to reset check-ins: ${error.message}`);
    } finally {
      setIsHoldingReset(false); // Ensure reset state is cleared
      setHoldProgress(0);
    }
  };

  const handleCoachLogout = async () => {
    if (auth) {
      try {
        await auth.signOut();
        setCoachLoggedIn(false);
        showCustomModal("You have been logged out as a coach.");
      } catch (error) {
        console.error("Error logging out coach:", error);
        showCustomModal(`Failed to log out: ${error.message}`);
      }
    }
  };

  if (!coachLoggedIn) {
    return (
      <CoachLoginModal
        onLoginSuccess={() => { /* App component's onAuthStateChanged will handle setCoachLoggedIn */ }}
        onCancel={() => setAppMode('checkIn')} // Go back to Check-In portal on cancel
      />
    );
  }


  return (
    <div className="bg-white rounded-xl shadow-lg p-6 max-w-6xl mx-auto min-h-[600px] flex flex-col">
      <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Coach Dashboard</h2>

      {/* Coach Navigation Tabs */}
      <div className="flex justify-center mb-6 space-x-4 flex-wrap gap-2">
        <button
          onClick={() => setCoachView('roster')}
          className={`px-6 py-3 rounded-lg font-semibold transition duration-300 ease-in-out ${
            coachView === 'roster' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100'
          }`}
        >
          Attendance View
        </button>
        <button
          onClick={() => setCoachView('profiles')}
          className={`px-6 py-3 rounded-lg font-semibold transition duration-300 ease-in-out ${
            coachView === 'profiles' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100'
          }`}
        >
          Athlete Profiles
        </button>
        <button
          onClick={() => setCoachView('management')}
          className={`px-6 py-3 rounded-lg font-semibold transition duration-300 ease-in-out ${
            coachView === 'management' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100'
          }`}
        >
          Coach Management
        </button>
        <button
          onClick={() => setCoachView('checkinLogs')}
          className={`px-6 py-3 rounded-lg font-semibold transition duration-300 ease-in-out ${
            coachView === 'checkinLogs' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100'
          }`}
        >
          Check-in Logs
        </button>
        <button
          onClick={handleCoachLogout}
          className="px-6 py-3 rounded-lg font-semibold bg-red-500 text-white shadow-lg hover:bg-red-600 transition duration-300 ease-in-out"
        >
          Logout
        </button>
      </div>

      {/* Reset Check-ins Button */}
      <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-center">
        <h4 className="text-xl font-semibold text-red-800 mb-2">Reset Daily Check-ins</h4>
        <p className="text-gray-700 mb-3">Hold the button for {RESET_HOLD_DURATION_SECONDS} seconds to reset all athletes' check-in status for the day. A log will be saved.</p>
        <button
          onMouseDown={handleResetMouseDown}
          onMouseUp={handleResetMouseUp}
          onMouseLeave={handleResetMouseUp} // Important: If mouse leaves while holding
          onTouchStart={handleResetMouseDown}
          onTouchEnd={handleResetMouseUp}
          onTouchCancel={handleResetMouseUp}
          className={`relative w-full px-8 py-3 rounded-lg font-bold text-white overflow-hidden transition-all duration-300 ease-in-out
                      ${isHoldingReset ? 'bg-red-700' : 'bg-red-600 hover:bg-red-700'}
                      shadow-lg`}
        >
          <div
            className="absolute top-0 left-0 h-full bg-red-400 opacity-50"
            style={{ width: `${(holdProgress / RESET_HOLD_DURATION_SECONDS) * 100}%` }}
          ></div>
          <span className="relative z-10">
            {isHoldingReset ? `Holding... ${RESET_HOLD_DURATION_SECONDS - holdProgress}s` : 'Hold to Reset Check-ins'}
          </span>
        </button>
      </div>

      {/* Conditional Rendering based on Coach View */}
      {coachView === 'roster' && <RosterView teams={teams} classes={classes} />}
      {coachView === 'profiles' && <AthleteProfiles teams={teams} classes={classes} />}
      {coachView === 'management' && <CoachManagement teams={teams} classes={classes} />} {/* Pass teams/classes to CoachManagement */}
      {coachView === 'checkinLogs' && <CheckinLogsView teams={teams} classes={classes} />}
    </div>
  );
};

// --- RosterView Component (for coaches to see check-ins) ---
const RosterView = ({ teams, classes }) => {
  const { athletes, currentDailyCheckins, appId } = useFirebase(); // Get currentDailyCheckins, appId
  const [selectedCategory, setSelectedCategory] = useState('team');
  const [selectedEntity, setSelectedEntity] = useState(teams[0]);

  const filteredAthletes = athletes.filter(athlete => {
    const categoryKey = selectedCategory === 'team' ? 'teams' : 'classes';
    return athlete.isApproved && athlete[categoryKey] && athlete[categoryKey].includes(selectedEntity);
  }).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex-grow flex flex-col p-4 bg-gray-50 rounded-lg shadow-inner">
      <h3 className="text-2xl font-bold text-gray-700 mb-4 text-center">Attendance Overview (Today)</h3>

      {/* Category and Entity Selector */}
      <div className="flex flex-col sm:flex-row justify-center items-center mb-6 space-y-4 sm:space-y-0 sm:space-x-6">
        <div className="flex space-x-3">
          <button
            onClick={() => { setSelectedCategory('team'); setSelectedEntity(teams[0]); }}
            className={`px-5 py-2 rounded-lg font-semibold ${
              selectedCategory === 'team' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-blue-100'
            }`}
          >
            View Teams
          </button>
          <button
            onClick={() => { setSelectedCategory('class'); setSelectedEntity(classes[0]); }}
            className={`px-5 py-2 rounded-lg font-semibold ${
              selectedCategory === 'class' ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-purple-100'
            }`}
          >
            View Classes
          </button>
        </div>

        <select
          value={selectedEntity}
          onChange={(e) => setSelectedEntity(e.target.value)}
          className="p-2 border border-gray-300 rounded-md shadow-sm w-full sm:w-auto focus:ring-blue-500 focus:border-blue-500 text-gray-800"
        >
          {(selectedCategory === 'team' ? teams : classes).map(entity => (
            <option key={entity} value={entity}>{entity}</option>
          ))}
        </select>
      </div>

      {/* Roster List */}
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white rounded-lg shadow overflow-hidden">
          <thead className="bg-gray-100 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Athlete Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Last Check-in Time (Today)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Activities Today</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredAthletes.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-6 py-4 text-center text-gray-500">No athletes in this {selectedCategory}.</td>
              </tr>
            ) : (
              filteredAthletes.map(athlete => {
                // Find all check-ins for this athlete for the selected entity today
                const athleteCheckinsToday = currentDailyCheckins.filter(
                  checkin => checkin.athleteId === athlete.id &&
                             checkin.checkInType === selectedCategory &&
                             checkin.checkInEntity === selectedEntity
                ).sort((a, b) => b.timestamp.toDate() - a.timestamp.toDate()); // Sort by most recent

                const hasCheckedInForThisEntity = athleteCheckinsToday.length > 0;
                const latestCheckin = hasCheckedInForThisEntity ? athleteCheckinsToday[0] : null;

                return (
                  <tr key={athlete.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{athlete.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          hasCheckedInForThisEntity
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {hasCheckedInForThisEntity ? 'Checked In' : 'Not Checked In'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {latestCheckin ? new Date(latestCheckin.timestamp.toDate()).toLocaleTimeString() : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {athleteCheckinsToday.map(checkin => (
                        <div key={checkin.id} className="text-xs">
                          {checkin.checkInEntity} at {new Date(checkin.timestamp.toDate()).toLocaleTimeString()}
                        </div>
                      ))}
                      {!hasCheckedInForThisEntity && "No activities logged today for this category."}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- CoachManagement Component (New) ---
const CoachManagement = ({ teams, classes }) => {
  const { db, userId, coaches, showCustomModal, showConfirmWithInputModal, auth, currentCoachUser, appId } = useFirebase(); // Destructure appId
  const [newCoachName, setNewCoachName] = useState('');
  const [newCoachEmail, setNewCoachEmail] = useState(''); // New field for coach email
  const [newCoachPhone, setNewCoachPhone] = useState('');
  const [newCoachTeams, setNewCoachTeams] = useState([]);
  const [newCoachClasses, setNewCoachClasses] = useState([]);
  const [editingCoach, setEditingCoach] = useState(null); // coach object when editing
  const [newCoachInitialPassword, setNewCoachInitialPassword] = useState(''); // For initial password setup

  const MASTER_PASSCODE = "cheer123"; // Master passcode for admin operations

  const handleAddCoach = async () => {
    if (!db || !userId || !auth || !appId) { // Check appId
      showCustomModal("Error: Database, Auth, or App ID not ready to add coach.");
      return;
    }
    if (!newCoachName.trim() || !newCoachEmail.trim() || !newCoachInitialPassword.trim()) {
      showCustomModal("Coach Name, Email, and Initial Password cannot be empty.");
      return;
    }

    showConfirmWithInputModal(
      "Enter MASTER passcode to add new coach:",
      async (enteredPasscode) => {
        if (enteredPasscode === MASTER_PASSCODE) {
          try {
            // 1. Create user in Firebase Authentication
            const userCredential = await createUserWithEmailAndPassword(auth, newCoachEmail.trim(), newCoachInitialPassword.trim());
            const newCoachFirebaseUid = userCredential.user.uid;
            console.log("CoachManagement: Firebase Auth user created:", newCoachFirebaseUid);

            // 2. Add coach data to Firestore
            // Use the 'appId' variable here
            const coachesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/coaches`);
            const docRef = doc(coachesCollectionRef); // Let Firestore generate ID
            await setDoc(docRef, {
              id: docRef.id,
              name: newCoachName.trim(),
              email: newCoachEmail.trim(),
              phone: newCoachPhone.trim(),
              isApproved: false, // New coaches need approval by default
              teams: newCoachTeams,
              classes: newCoachClasses,
              firebaseUid: newCoachFirebaseUid, // Link to Firebase Auth user
            });
            console.log("CoachManagement: Coach added to Firestore successfully! Awaiting approval.");
            showCustomModal("Coach added successfully! Awaiting approval.");

            // Clear form fields
            setNewCoachName('');
            setNewCoachEmail('');
            setNewCoachPhone('');
            setNewCoachTeams([]);
            setNewCoachClasses([]);
            setNewCoachInitialPassword('');
          } catch (error) {
            console.error("CoachManagement: Error adding coach:", error);
            let errorMessage = `Failed to add coach: ${error.message}`;
            if (error.code === 'auth/email-already-in-use') {
              errorMessage = "Email already in use. Please use a different email.";
            } else if (error.code === 'auth/weak-password') {
              errorMessage = "Password is too weak. Please choose a stronger password (at least 6 characters).";
            }
            showCustomModal(errorMessage);
          }
        } else {
          showCustomModal("Incorrect MASTER passcode. Coach not added.");
        }
      },
      () => { /* do nothing on cancel */ }
    );
  };

  const handleEditCoach = (coach) => {
    showConfirmWithInputModal(
      "Enter MASTER passcode to edit coach:",
      (enteredPasscode) => {
        if (enteredPasscode === MASTER_PASSCODE) {
          setEditingCoach({
            ...coach,
            teams: coach.teams || [], // Ensure teams is an array
            classes: coach.classes || [], // Ensure classes is an array
          });
          console.log("CoachManagement: Correct passcode, enabling edit for coach:", coach.name);
        } else {
          console.warn("CoachManagement: Incorrect MASTER passcode for coach edit.");
          showCustomModal("Incorrect MASTER passcode. You do not have permission to edit this coach.");
        }
      },
      () => { /* do nothing on cancel */ }
    );
  };

  const handleUpdateCoach = async () => {
    if (!db || !userId || !editingCoach || !auth || !currentCoachUser || !appId) { // Check appId
      showCustomModal("Error: Database, Auth, or coach data not ready to update.");
      return;
    }
    if (!editingCoach.name.trim() || !editingCoach.email.trim()) {
      showCustomModal("Coach Name and Email cannot be empty.");
      return;
    }

    showConfirmWithInputModal(
      "Enter MASTER passcode to confirm update:",
      async (enteredPasscode) => {
        if (enteredPasscode === MASTER_PASSCODE) {
          try {
            const batch = writeBatch(db);

            // 1. Update Firestore coach document
            // Use the 'appId' variable here
            const coachRef = doc(db, `artifacts/${appId}/users/${userId}/coaches`, editingCoach.id);
            batch.update(coachRef, {
              name: editingCoach.name.trim(),
              email: editingCoach.email.trim(), // Email can be updated in Firestore
              phone: editingCoach.phone.trim(),
              teams: editingCoach.teams,
              classes: editingCoach.classes,
              // firebaseUid should not be changed here as it's the link to the auth user
            });

            // 2. If email changed, update Firebase Auth email
            if (editingCoach.email !== coaches.find(c => c.id === editingCoach.id)?.email) {
                // Ensure `updateEmail` is imported from firebase/auth
                const userToUpdate = auth.currentUser; // Assuming the current user is the admin making the change
                if (userToUpdate && userToUpdate.uid === editingCoach.firebaseUid) { // Check if admin is editing their own email
                    await updateEmail(userToUpdate, editingCoach.email.trim()); // Update email in Firebase Auth
                    console.log(`CoachManagement: Firebase Auth email updated for ${editingCoach.name}.`);
                } else {
                    // If trying to update another coach's auth email, this would require Cloud Functions or elevated privileges
                    // For this app's scope, we'll assume direct update only for the current user's email or not supported for others
                    console.warn("Attempted to update another coach's Firebase Auth email directly from client. This is generally not allowed without re-auth or admin SDK.");
                }
            }

            await batch.commit();
            setEditingCoach(null);
            console.log("CoachManagement: Coach updated successfully!");
            showCustomModal("Coach updated successfully!");
          } catch (error) {
            console.error("CoachManagement: Error updating coach:", error);
            let errorMessage = `Failed to update coach: ${error.message}`;
            if (error.code === 'auth/email-already-in-use') {
              errorMessage = "The new email is already in use by another account.";
            } else if (error.code === 'auth/requires-recent-login') {
                errorMessage = "This operation requires recent authentication. Please re-enter your MASTER password.";
            }
            showCustomModal(errorMessage);
          }
        } else {
          showCustomModal("Incorrect MASTER passcode. Coach not updated.");
        }
      },
      () => { /* do nothing on cancel */ }
    );
  };

  const handleChangeCoachPassword = (coach) => {
    showConfirmWithInputModal(
      `Enter MASTER passcode to change password for ${coach.name}:`,
      async (enteredMasterPasscode) => {
        if (enteredMasterPasscode === MASTER_PASSCODE) {
          showConfirmWithInputModal(
            `Enter NEW password for ${coach.name}:`,
            async (newPassword) => {
              if (!newPassword || newPassword.length < 6) {
                showCustomModal("New password must be at least 6 characters long.");
                return;
              }
              if (!auth || !currentCoachUser) {
                showCustomModal("Authentication context not available. Cannot change password.");
                return;
              }

              try {
                // Re-authenticate the current admin user (currentCoachUser) with their email and the master password
                const credential = EmailAuthProvider.credential(currentCoachUser.email, enteredMasterPasscode);
                await reauthenticateWithCredential(currentCoachUser, credential);

                // Now update the target coach's password using their firebaseUid
                // This specific method (updatePassword directly on a user fetched by auth.getUser)
                // is typically available in Node.js server environments (Admin SDK).
                // In a client-side React app, `updatePassword` works on the currently authenticated user (`auth.currentUser`).
                // To change another user's password, you'd generally need to use Firebase Cloud Functions or a similar backend.
                // For the scope of this example, we'll adjust to show a warning or re-evaluate.
                // For a client-side solution, you would typically have the coach themselves log in and change their password.
                // Since this is `CoachManagement`, implying admin, a Cloud Function would be the secure way.
                // For demonstration, we'll simulate it by applying `updatePassword` to the current admin,
                // which means the admin would be changing THEIR OWN password, not another coach's.
                // If the `firebaseUid` is the `currentCoachUser.uid`, it will work. Otherwise, it won't.

                if (coach.firebaseUid === currentCoachUser.uid) {
                    await updatePassword(currentCoachUser, newPassword);
                    showCustomModal(`Your password has been changed successfully!`);
                    console.log(`Password for current coach (${coach.name}) changed successfully.`);
                } else {
                    showCustomModal("Admin can only change their own password directly in this app's client-side implementation. To change another coach's password, please log in as that coach or use Firebase Admin SDK via a secure backend.");
                    console.warn("Client-side attempt to change another coach's password blocked.");
                }

              } catch (error) {
                console.error("Error changing coach password:", error);
                let errorMessage = `Failed to change password: ${error.message}`;
                if (error.code === 'auth/weak-password') {
                  errorMessage = "The new password is too weak. It must be at least 6 characters.";
                } else if (error.code === 'auth/requires-recent-login') {
                    errorMessage = "This operation requires recent authentication. Please re-enter your MASTER password.";
                } else if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
                  errorMessage = "Incorrect MASTER passcode entered during re-authentication.";
                }
                showCustomModal(errorMessage);
              }
            },
            () => { /* cancel new password entry */ }
          );
        } else {
          showCustomModal("Incorrect MASTER passcode. Password change denied.");
        }
      },
      () => { /* cancel master passcode entry */ }
    );
  };


  const handleApproveCoach = (coach) => {
    showConfirmWithInputModal(
      `Approve ${coach.name}? Enter MASTER passcode:`,
      async (enteredPasscode) => {
        if (enteredPasscode === MASTER_PASSCODE) {
          try {
            // Use the 'appId' variable here
            const coachRef = doc(db, `artifacts/${appId}/users/${userId}/coaches`, coach.id);
            await updateDoc(coachRef, { isApproved: true });
            console.log("CoachManagement: Coach approved successfully!");
            showCustomModal(`${coach.name} approved successfully!`);
          } catch (error) {
            console.error("CoachManagement: Error approving coach:", error);
            showCustomModal(`Failed to approve coach: ${error.message}`);
          }
        } else {
          console.warn("CoachManagement: Incorrect MASTER passcode for coach approval.");
          showCustomModal("Incorrect MASTER passcode. Approval denied.");
        }
      },
      () => { /* do nothing on cancel */ }
    );
  };

  const handleDeleteCoach = (coach) => {
    showConfirmWithInputModal(
      `Are you sure you want to delete ${coach.name}?\nThis action cannot be undone. Enter MASTER passcode to confirm:`,
      async (enteredPasscode) => {
        if (enteredPasscode === MASTER_PASSCODE) {
          try {
            const batch = writeBatch(db);

            // 1. Delete coach document from Firestore
            // Use the 'appId' variable here
            const coachRef = doc(db, `artifacts/${appId}/users/${userId}/coaches`, coach.id);
            batch.delete(coachRef);

            await batch.commit();

            // 2. Delete user from Firebase Authentication
            if (coach.firebaseUid && auth.currentUser) {
              try {
                // Re-authenticate the current admin user (currentCoachUser) before deleting another user
                // This is a security measure for sensitive operations
                const credential = EmailAuthProvider.credential(auth.currentUser.email, enteredPasscode);
                await reauthenticateWithCredential(auth.currentUser, credential);
                // Now attempt to delete the target user
                // Note: direct client-side `deleteUser` on another user requires very specific conditions
                // (e.g., if the user is currently authenticated with their own credentials and confirms deletion).
                // For an admin to delete *any* user, it typically requires the Firebase Admin SDK on a backend.
                // We'll adjust this to reflect client-side limitations, meaning the admin can mostly delete
                // users they've just created and not fully signed out, or if the user is their own account.
                // For a robust solution, Firebase Cloud Functions are recommended for this.

                // If the user to delete is the currently logged-in user, allow deletion.
                if (auth.currentUser.uid === coach.firebaseUid) {
                    await deleteUser(auth.currentUser); // Deletes the currently logged-in user
                    setCoachLoggedIn(false); // Log out the user immediately
                    showCustomModal(`Your coach account (${coach.name}) has been deleted.`);
                    console.log(`CoachManagement: Current Firebase Auth user (${coach.name}) deleted.`);
                } else {
                    showCustomModal("Admin can only delete their own Firebase Auth account directly from the client. To delete other coach accounts, please use Firebase Admin SDK via a secure backend (e.g., Cloud Functions).");
                    console.warn("Client-side attempt to delete another coach's Firebase Auth user blocked.");
                }

              } catch (reauthError) {
                console.error("CoachManagement: Re-authentication failed or user not found for deletion:", reauthError);
                showCustomModal(`Failed to delete Firebase Auth user for ${coach.name}. Error: ${reauthError.message}`);
                // If reauthentication fails or user not found, only Firestore doc is deleted.
              }
            }

            console.log("CoachManagement: Coach deleted successfully!");
            showCustomModal(`${coach.name} deleted successfully!`);
          } catch (error) {
            console.error("CoachManagement: Error deleting coach:", error);
            showCustomModal(`Failed to delete coach: ${error.message}`);
          }
        } else {
          showCustomModal("Incorrect MASTER passcode. Coach not deleted.");
        }
      },
      () => { /* do nothing on cancel */ }
    );
  };


  const handleCancelEdit = () => {
    setEditingCoach(null);
  };

  return (
    <div className="flex-grow flex flex-col p-4 bg-gray-50 rounded-lg shadow-inner">
      <h3 className="text-2xl font-bold text-gray-700 mb-4 text-center">Manage Coaches</h3>

      {/* Add/Edit Coach Form */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <h4 className="text-xl font-semibold text-gray-800 mb-4">{editingCoach ? 'Edit Coach' : 'Add New Coach'}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="coachName" className="block text-sm font-medium text-gray-700 mb-1">Coach Name</label>
            <input
              type="text"
              id="coachName"
              value={editingCoach ? editingCoach.name : newCoachName}
              onChange={(e) => editingCoach ? setEditingCoach(prev => ({ ...prev, name: e.target.value })) : setNewCoachName(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="Coach Name"
              readOnly={!!editingCoach} // Name is read-only when editing a coach
            />
          </div>
          <div>
            <label htmlFor="coachEmail" className="block text-sm font-medium text-gray-700 mb-1">Coach Email</label>
            <input
              type="email"
              id="coachEmail"
              value={editingCoach ? editingCoach.email : newCoachEmail}
              onChange={(e) => editingCoach ? setEditingCoach(prev => ({ ...prev, email: e.target.value })) : setNewCoachEmail(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="coach@example.com"
              readOnly={!!editingCoach} // Email is read-only when editing coach (as it's tied to auth user)
            />
          </div>
          <div>
            <label htmlFor="coachPhone" className="block text-sm font-sm text-gray-700 mb-1">Phone Number</label>
            <input
              type="tel" // Use type tel for phone numbers
              id="coachPhone"
              value={formatPhoneNumber(editingCoach ? editingCoach.phone : newCoachPhone)}
              onChange={(e) => editingCoach ? setEditingCoach(prev => ({ ...prev, phone: formatPhoneNumber(e.target.value) })) : setNewCoachPhone(formatPhoneNumber(e.target.value))}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="###-###-####"
              readOnly={!!editingCoach}
            />
          </div>
          {!editingCoach && ( // Only show initial password when adding a new coach
            <div>
              <label htmlFor="initialPassword" className="block text-sm font-medium text-gray-700 mb-1">Initial Password *</label>
              <input
                type="password"
                id="initialPassword"
                value={newCoachInitialPassword}
                onChange={(e) => setNewCoachInitialPassword(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="Set initial password"
              />
            </div>
          )}
          {/* Teams Input for Coaches */}
          <div className="md:col-span-2"> {/* Span both columns for better layout */}
            <TagsInput
              label="Assigned Teams"
              options={teams}
              selectedOptions={editingCoach ? editingCoach.teams : newCoachTeams}
              onChange={(newSelection) => editingCoach ? setEditingCoach(prev => ({ ...prev, teams: newSelection })) : setNewCoachTeams(newSelection)}
              readOnly={!!editingCoach}
            />
          </div>
          {/* Classes Input for Coaches */}
          <div className="md:col-span-2"> {/* Span both columns for better layout */}
            <TagsInput
              label="Assigned Classes"
              options={classes}
              selectedOptions={editingCoach ? editingCoach.classes : newCoachClasses}
              onChange={(newSelection) => editingCoach ? setEditingCoach(prev => ({ ...prev, classes: newSelection })) : setNewCoachClasses(newSelection)}
              readOnly={!!editingCoach}
            />
          </div>
        </div>
        <div className="flex justify-end space-x-4 mt-4">
          {editingCoach && (
            <button
              onClick={handleCancelEdit}
              className="px-6 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 transition duration-200 font-semibold"
            >
              Cancel
            </button>
          )}
          {editingCoach ? (
             <button
               onClick={handleUpdateCoach}
               className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition duration-200 font-semibold"
             >
               Update Coach
             </button>
          ) : (
            <button
              onClick={handleAddCoach}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition duration-200 font-semibold"
            >
              Add Coach
            </button>
          )}
        </div>
      </div>

      {/* Coaches List */}
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white rounded-lg shadow overflow-hidden">
          <thead className="bg-gray-100 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Coach Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Email</th> {/* New Column */}
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Phone</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Teams</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Classes</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {coaches.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-6 py-4 text-center text-gray-500">No coaches added yet.</td>
              </tr>
            ) : (
              coaches.map(coach => (
                <tr key={coach.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{coach.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{coach.email}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{coach.phone}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    {(coach.teams && coach.teams.length > 0) ? coach.teams.join(', ') : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    {(coach.classes && coach.classes.length > 0) ? coach.classes.join(', ') : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        coach.isApproved
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {coach.isApproved ? 'Approved' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex flex-col space-y-2">
                      {!coach.isApproved && (
                        <button
                          onClick={() => handleApproveCoach(coach)}
                          className="text-green-600 hover:text-green-900 transition duration-200 text-left"
                        >
                          Approve
                        </button>
                      )}
                      <button
                        onClick={() => handleEditCoach(coach)}
                        className="text-indigo-600 hover:text-indigo-900 transition duration-200 text-left"
                        >
                        Edit
                      </button>
                      {coach.firebaseUid && ( // Only show change password if firebaseUid exists
                        <button
                          onClick={() => handleChangeCoachPassword(coach)}
                          className="text-purple-600 hover:text-purple-900 transition duration-200 text-left"
                        >
                          Change Password
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteCoach(coach)}
                        className="text-red-600 hover:text-red-900 transition duration-200 text-left"
                        >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

// --- CheckinLogsView Component ---
const CheckinLogsView = ({ teams, classes }) => { // Pass teams and classes
    const { db, userId, athletes, showCustomModal, showConfirmWithInputModal, appId } = useFirebase(); // Destructure appId
    const [checkinLogs, setCheckinLogs] = useState([]);
    const [editingLogEntryId, setEditingLogEntryId] = useState(null);
    const [currentLogAthletes, setCurrentLogAthletes] = useState([]); // State for athletes within the log being edited

    const [filterAthleteName, setFilterAthleteName] = useState('');
    const [filterStatus, setFilterStatus] = useState('All'); // 'All', 'Checked In', 'Missed'
    const [filterCategory, setFilterCategory] = useState('All'); // 'All', 'team', 'class'
    const [filterEntity, setFilterEntity] = useState('All'); // Specific team or class name

    // States for adding manual check-in
    const [showAddManualCheckinModal, setShowAddManualCheckinModal] = useState(false);
    const [manualCheckinAthleteId, setManualCheckinAthleteId] = useState('');
    const [manualCheckinCategory, setManualCheckinCategory] = useState('team');
    const [manualCheckinEntity, setManualCheckinEntity] = useState('');
    const [manualCheckinTimestamp, setManualCheckinTimestamp] = useState('');


    const MASTER_PASSCODE = "cheer123";

    useEffect(() => {
        if (db && userId && appId) { // Check appId
            const logsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/checkin_logs`); // Use appId
            const q = query(logsCollectionRef);

            const unsubscribe = onSnapshot(q, (snapshot) => {
                const fetchedLogs = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    // Ensure timestamp is converted to a Date object initially for easier manipulation
                    timestamp: doc.data().timestamp?.toDate(),
                })).sort((a, b) => b.timestamp - a.timestamp); // Sort by most recent first
                setCheckinLogs(fetchedLogs);
            }, (error) => {
                console.error("Error fetching check-in logs:", error);
                showCustomModal(`Failed to fetch check-in logs: ${error.message}`);
            });
            return () => unsubscribe();
        }
    }, [db, userId, appId]); // Add appId to dependencies

    // Initialize manualCheckinEntity when filterCategory changes
    useEffect(() => {
      if (manualCheckinCategory === 'team') {
        setManualCheckinEntity(teams[0] || '');
      } else if (manualCheckinCategory === 'class') {
        setManualCheckinEntity(classes[0] || '');
      } else {
        setManualCheckinEntity('');
      }
    }, [manualCheckinCategory, teams, classes]);


    const handleEditLog = (logEntry) => {
        showConfirmWithInputModal(
            "Enter MASTER passcode to edit this log entry:",
            (enteredPasscode) => {
                if (enteredPasscode === MASTER_PASSCODE) {
                    setEditingLogEntryId(logEntry.id);
                    // Deep copy the events array, ensuring timestamp is a Date object for editing
                    setCurrentLogAthletes(logEntry.dailyCheckInEvents ?
                        JSON.parse(JSON.stringify(logEntry.dailyCheckInEvents)).map(event => ({
                            ...event,
                            timestamp: event.timestamp ? new Timestamp(event.timestamp.seconds, event.timestamp.nanoseconds).toDate() : null // Convert Firestore Timestamp to Date object
                        })) : []);
                    // Initialize manual check-in timestamp to the log's timestamp
                    setManualCheckinTimestamp(formatToDatetimeLocal(logEntry.timestamp || new Date()));
                } else {
                    showCustomModal("Incorrect MASTER passcode. You do not have permission to edit this log.");
                }
            },
            () => {} // Cancel callback
        );
    };

    const handleRemoveAthleteFromLog = (indexToRemove) => {
        setCurrentLogAthletes(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const handleUpdateAthleteFieldInLog = (index, field, value) => {
        setCurrentLogAthletes(prev => {
            const updated = [...prev];
            if (field === 'timestamp') {
                // `datetime-local` input returns a string like "YYYY-MM-DDTHH:mm"
                updated[index] = { ...updated[index], [field]: value ? new Date(value) : null };
            } else {
                updated[index] = { ...updated[index], [field]: value };
            }
            return updated;
        });
    };

    const handleSaveLogChanges = async () => {
        if (!db || !userId || !editingLogEntryId || !appId) return; // Check appId

        try {
            const logDocRef = doc(db, `artifacts/${appId}/users/${userId}/checkin_logs`, editingLogEntryId); // Use appId

            // Convert Date objects back to Firestore Timestamps for saving
            const eventsToSave = currentLogAthletes.map(event => {
                // Ensure 'status' field is not saved to Firestore for actual check-in events
                const { status, ...rest } = event;
                return {
                    ...rest,
                    timestamp: event.timestamp ? Timestamp.fromDate(event.timestamp) : null
                };
            });

            await updateDoc(logDocRef, {
                dailyCheckInEvents: eventsToSave,
                lastEdited: Timestamp.now(), // Add a field to track when it was last edited
            });
            showCustomModal("Check-in log updated successfully!");
            setEditingLogEntryId(null);
            setCurrentLogAthletes([]);
        } catch (error) {
            console.error("Error saving log changes:", error);
            showCustomModal(`Failed to save log changes: ${error.message}`);
        }
    };

    const handleCancelLogEdit = () => {
        setEditingLogEntryId(null);
        setCurrentLogAthletes([]);
    };

    const handleAddManualCheckinClick = () => {
      setShowAddManualCheckinModal(true);
      // Reset modal states
      setManualCheckinAthleteId('');
      setManualCheckinCategory('team');
      setManualCheckinEntity(teams[0] || '');
      // manualCheckinTimestamp is already initialized to log's timestamp
    };

    const handleConfirmManualCheckin = () => {
      if (!manualCheckinAthleteId || !manualCheckinCategory || !manualCheckinEntity || !manualCheckinTimestamp) {
        showCustomModal("Please fill all fields for the manual check-in.");
        return;
      }

      const selectedAthlete = athletes.find(a => a.id === manualCheckinAthleteId);
      if (!selectedAthlete) {
        showCustomModal("Selected athlete not found.");
        return;
      }

      // Check if an entry for this athlete, type, and entity already exists in currentLogAthletes
      const alreadyExists = currentLogAthletes.some(
        event => event.athleteId === manualCheckinAthleteId &&
                 event.checkInType === manualCheckinCategory &&
                 event.checkInEntity === manualCheckinEntity
      );

      if (alreadyExists) {
        showCustomModal("This athlete is already recorded for this team/class in this log. Please edit the existing entry or choose a different activity.");
        return;
      }


      const newEntry = {
        athleteId: manualCheckinAthleteId,
        athleteName: selectedAthlete.name,
        checkInType: manualCheckinCategory,
        checkInEntity: manualCheckinEntity,
        timestamp: new Date(manualCheckinTimestamp), // Convert datetime-local string to Date object
      };

      setCurrentLogAthletes(prev => [...prev, newEntry]);
      setShowAddManualCheckinModal(false);
      setManualCheckinAthleteId('');
      setManualCheckinCategory('team');
      setManualCheckinEntity(teams[0] || '');
      // manualCheckinTimestamp will be reset when edit mode is exited
    };

    const handleCancelManualCheckin = () => {
      setShowAddManualCheckinModal(false);
      setManualCheckinAthleteId('');
      setManualCheckinCategory('team');
      setManualCheckinEntity(teams[0] || '');
    };

    // Filtered logs logic
    const filteredLogs = checkinLogs.map(log => {
        const approvedAthletes = athletes.filter(a => a.isApproved);
        const checkedInAthleteEventsForLog = log.dailyCheckInEvents || [];

        let currentLogCombinedEvents = []; // This will hold both checked-in and missed events for *this specific log*

        // Iterate over all approved athletes to determine their status for the applied filters
        approvedAthletes.forEach(athlete => {
            const athleteId = athlete.id;
            const athleteNameLower = athlete.name.toLowerCase();

            // Check name filter first, if it doesn't match, skip this athlete entirely for this log display
            if (!athleteNameLower.includes(filterAthleteName.toLowerCase())) {
                return;
            }

            const athleteTeams = athlete.teams || [];
            const athleteClasses = athlete.classes || [];

            // Determine all entities this athlete is "expected" to be associated with based on filters
            let expectedEntities = [];
            if (filterCategory === 'All' || filterCategory === 'team') {
                const relevantTeams = filterEntity === 'All' ? athleteTeams : athleteTeams.filter(t => t === filterEntity);
                expectedEntities = [...expectedEntities, ...relevantTeams.map(team => ({ type: 'team', name: team }))];
            }
            if (filterCategory === 'All' || filterCategory === 'class') {
                const relevantClasses = filterEntity === 'All' ? athleteClasses : athleteClasses.filter(c => c === filterEntity);
                expectedEntities = [...expectedEntities, ...relevantClasses.map(cls => ({ type: 'class', name: cls }))];
            }

            expectedEntities.forEach(expected => {
                const hasActualCheckin = checkedInAthleteEventsForLog.some(event =>
                    event.athleteId === athleteId &&
                    event.checkInType === expected.type &&
                    event.checkInEntity === expected.name
                );

                if (hasActualCheckin) {
                    // If there's an actual check-in for this specific entity, add it if the status filter allows
                    if (filterStatus === 'Checked In' || filterStatus === 'All') {
                        // Find the actual check-in event to get its timestamp
                        const actualCheckinEvent = checkedInAthleteEventsForLog.find(event =>
                            event.athleteId === athleteId &&
                            event.checkInType === expected.type &&
                            event.checkInEntity === expected.name
                        );
                        currentLogCombinedEvents.push({
                            athleteId: athleteId,
                            athleteName: athlete.name,
                            checkInType: expected.type,
                            checkInEntity: expected.name,
                            timestamp: actualCheckinEvent.timestamp, // Use the actual timestamp
                            status: 'Checked In'
                        });
                    }
                } else {
                    // If no actual check-in for this specific entity, it's a 'missed' entry if the status filter allows
                    if (filterStatus === 'Missed' || filterStatus === 'All') {
                        // Check if this particular athlete + expected entity combo hasn't already been added as "checked in"
                        // (This handles cases where filterStatus is 'All' and an athlete checks into one entity but misses another)
                        const isAlreadyAddedAsCheckedIn = currentLogCombinedEvents.some(item =>
                            item.athleteId === athleteId &&
                            item.checkInType === expected.type &&
                            item.checkInEntity === expected.name &&
                            item.status === 'Checked In'
                        );

                        if (!isAlreadyAddedAsCheckedIn) {
                            currentLogCombinedEvents.push({
                                athleteId: athleteId,
                                athleteName: athlete.name,
                                checkInType: expected.type,
                                checkInEntity: expected.name,
                                timestamp: null, // No timestamp for a missed entry
                                status: 'Missed'
                            });
                        }
                    }
                }
            });
        });

        // Remove duplicates if the same event was added multiple times due to complex filtering.
        // Use a unique key for each event: athleteId_checkInType_checkInEntity_status
        const uniqueEventsMap = new Map();
        currentLogCombinedEvents.forEach(event => {
            const key = `${event.athleteId}_${event.checkInType}_${event.checkInEntity}_${event.status}`;
            uniqueEventsMap.set(key, event);
        });
        const finalEvents = Array.from(uniqueEventsMap.values());


        // Sort the final events for consistent display
        finalEvents.sort((a, b) => {
            // Sort by status (Checked In first, then Missed), then by name, then by timestamp
            if (a.status === 'Missed' && b.status !== 'Missed') return 1;
            if (a.status !== 'Missed' && b.status === 'Missed') return -1;

            const nameComparison = a.athleteName.localeCompare(b.athleteName);
            if (nameComparison !== 0) return nameComparison;

            // Safely get timestamp for sorting, converting if it's a Firestore Timestamp
            const timestampA = a.timestamp ? (a.timestamp instanceof Timestamp ? a.timestamp.toDate().getTime() : a.timestamp.getTime()) : 0;
            const timestampB = b.timestamp ? (b.timestamp instanceof Timestamp ? b.timestamp.toDate().getTime() : b.timestamp.getTime()) : 0;
            return timestampA - timestampB;
        });

        // Only include the log if it has events after filtering
        if (finalEvents.length > 0) {
            return { ...log, filteredDailyCheckInEvents: finalEvents };
        }
        return null;
    }).filter(Boolean); // Remove null entries


    return (
        <div className="flex-grow flex flex-col p-4 bg-gray-50 rounded-lg shadow-inner">
            <h3 className="text-2xl font-bold text-gray-700 mb-4 text-center">Daily Check-in History</h3>

            {/* Filters */}
            <div className="bg-white rounded-lg shadow-md p-4 mb-6 flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4">
                <input
                    type="text"
                    placeholder="Filter by athlete name..."
                    value={filterAthleteName}
                    onChange={(e) => setFilterAthleteName(e.target.value)}
                    className="p-2 border border-gray-300 rounded-md shadow-sm w-full sm:flex-grow focus:ring-blue-500 focus:border-blue-500 text-gray-800"
                />
                <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="p-2 border border-gray-300 rounded-md shadow-sm w-full sm:w-auto focus:ring-blue-500 focus:border-blue-500 text-gray-800"
                >
                    <option value="All">All Statuses</option>
                    <option value="Checked In">Checked In</option>
                    <option value="Missed">Missed</option>
                </select>

                <div className="flex w-full sm:w-auto space-x-2 justify-center">
                    <button
                        onClick={() => { setFilterCategory('All'); setFilterEntity('All'); }}
                        className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-200 ${
                            filterCategory === 'All' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        All Categories
                    </button>
                    <button
                        onClick={() => { setFilterCategory('team'); setFilterEntity(teams[0] || 'All'); }}
                        className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-200 ${
                            filterCategory === 'team' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        Filter by Team
                    </button>
                    <button
                        onClick={() => { setFilterCategory('class'); setFilterEntity(classes[0] || 'All'); }}
                        className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-200 ${
                            filterCategory === 'class' ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                        Filter by Class
                    </button>
                </div>
                {filterCategory !== 'All' && (
                    <select
                        value={filterEntity}
                        onChange={(e) => setFilterEntity(e.target.value)}
                        className="p-2 border border-gray-300 rounded-md shadow-sm w-full sm:w-auto focus:ring-blue-500 focus:border-blue-500 text-gray-800"
                    >
                        <option value="All">All {filterCategory === 'team' ? 'Teams' : 'Classes'}</option>
                        {(filterCategory === 'team' ? teams : classes).map(entity => (
                            <option key={entity} value={entity}>{entity}</option>
                        ))}
                    </select>
                )}
            </div>


            {filteredLogs.length === 0 ? (
                <p className="text-center text-gray-600 text-lg">No check-in logs found matching your filters yet.</p>
            ) : (
                <div className="space-y-6">
                    {filteredLogs.map(log => (
                        <div key={log.id} className="bg-white rounded-lg shadow-md p-4 border border-gray-200">
                            <div className="flex justify-between items-center mb-3">
                                <p className="text-lg font-semibold text-gray-800">
                                    Reset on: {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                                </p>
                                {editingLogEntryId === log.id ? (
                                    <div className="flex space-x-2">
                                        <button
                                            onClick={handleSaveLogChanges}
                                            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition duration-200 text-sm"
                                        >
                                            Save Changes
                                        </button>
                                        <button
                                            onClick={handleCancelLogEdit}
                                            className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-200 text-sm"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                          onClick={handleAddManualCheckinClick}
                                          className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition duration-200 text-sm"
                                        >
                                          Add Manual Check-in
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => handleEditLog(log)}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-200 text-sm"
                                    >
                                        Edit Log
                                    </button>
                                )}
                            </div>

                            <p className="text-sm text-gray-600 mb-2">Reset by User ID: {log.resetByUserId}</p>

                            <h5 className="font-medium text-gray-700 mb-2">Checked-in Athletes:</h5>
                            {log.filteredDailyCheckInEvents.length === 0 ? (
                                <p className="text-sm text-gray-500 italic">No athletes in this log entry matching current filters.</p>
                            ) : (
                                <ul className="list-disc list-inside space-y-1 text-sm text-gray-800">
                                    {editingLogEntryId === log.id ? (
                                        currentLogAthletes.map((event, index) => (
                                            <li key={index} className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-gray-50 p-2 rounded-md mb-2">
                                                <div className="flex-grow flex flex-col sm:flex-row sm:items-center w-full sm:w-auto">
                                                    <input
                                                        type="text"
                                                        value={event.athleteName}
                                                        onChange={(e) => handleUpdateAthleteFieldInLog(index, 'athleteName', e.target.value)}
                                                        className="flex-grow p-1 border border-gray-300 rounded-md text-sm mr-2 mb-2 sm:mb-0"
                                                    />
                                                    {event.status !== 'Missed' && ( // Only show datetime for checked-in events
                                                      <input
                                                          type="datetime-local"
                                                          value={formatToDatetimeLocal(event.timestamp)}
                                                          onChange={(e) => handleUpdateAthleteFieldInLog(index, 'timestamp', e.target.value)}
                                                          className="p-1 border border-gray-300 rounded-md text-sm"
                                                      />
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => handleRemoveAthleteFromLog(index)}
                                                    className="text-red-500 hover:text-red-700 text-xs mt-2 sm:mt-0 sm:ml-4 flex-shrink-0"
                                                >
                                                    Remove
                                                </button>
                                            </li>
                                        ))
                                    ) : (
                                        log.filteredDailyCheckInEvents.map((event, index) => (
                                            <li key={index} className={`${event.status === 'Missed' ? 'text-red-700' : ''}`}>
                                                {event.athleteName} ({event.checkInType}: {event.checkInEntity}) - {event.timestamp ? new Date(event.timestamp.toDate()).toLocaleTimeString() : (event.status === 'Missed' ? 'Missed' : 'N/A')}
                                            </li>
                                        ))
                                    )}
                                </ul>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Add Manual Check-in Modal */}
            {showAddManualCheckinModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full">
                        <h4 className="text-xl font-semibold text-gray-800 mb-4 text-center">Add Manual Check-in</h4>
                        <div className="mb-4">
                            <label htmlFor="manualAthlete" className="block text-sm font-medium text-gray-700 mb-1">Athlete</label>
                            <select
                                id="manualAthlete"
                                value={manualCheckinAthleteId}
                                onChange={(e) => setManualCheckinAthleteId(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="">Select Athlete</option>
                                {athletes.filter(a => a.isApproved).sort((a,b) => a.name.localeCompare(b.name)).map(athlete => (
                                    <option key={athlete.id} value={athlete.id}>{athlete.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="manualCategory" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                            <select
                                id="manualCategory"
                                value={manualCheckinCategory}
                                onChange={(e) => setManualCheckinCategory(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="team">Team</option>
                                <option value="class">Class</option>
                            </select>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="manualEntity" className="block text-sm font-medium text-gray-700 mb-1">Team/Class Name</label>
                            <select
                                id="manualEntity"
                                value={manualCheckinEntity}
                                onChange={(e) => setManualCheckinEntity(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="">Select {manualCheckinCategory === 'team' ? 'Team' : 'Class'}</option>
                                {(manualCheckinCategory === 'team' ? teams : classes).map(entity => (
                                    <option key={entity} value={entity}>{entity}</option>
                                ))}
                            </select>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="manualTimestamp" className="block text-sm font-medium text-gray-700 mb-1">Check-in Time</label>
                            <input
                                type="datetime-local"
                                id="manualTimestamp"
                                value={manualCheckinTimestamp}
                                onChange={(e) => setManualCheckinTimestamp(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div className="flex justify-end space-x-4">
                            <button
                                onClick={handleCancelManualCheckin}
                                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmManualCheckin}
                                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition duration-200"
                            >
                                Add Check-in
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

  // --- AthleteProfiles Component (for coaches to manage athlete data) ---
  const AthleteProfiles = ({ teams, classes }) => {
    const { athletes, showCustomModal, showConfirmWithInputModal, db, userId, coaches, appId } = useFirebase(); // Destructure appId
    const [searchTerm, setSearchTerm] = useState('');
    const [editingAthlete, setEditingAthlete] = useState(null); // athlete object when editing
    const [viewingAthlete, setViewingAthlete] = useState(null); // athlete object when viewing (read-only)
    const [isAddingNew, setIsAddingNew] = useState(false); // State for adding new athlete

    const MASTER_PASSCODE = "cheer123"; // Master passcode for editing and approval

    const approvedAthletes = athletes.filter(athlete => athlete.isApproved);
    const pendingAthletes = athletes.filter(athlete => !athlete.isApproved);

    const filteredAthletes = approvedAthletes.filter(athlete =>
      athlete.name.toLowerCase().includes(searchTerm.toLowerCase())
    ).sort((a, b) => a.name.localeCompare(b.name));

    // Function to save or update athlete
    const handleSaveAthlete = async (athleteData) => {
      if (!db || !userId || !appId) { // Check appId
        showCustomModal("Error: Database or App ID not ready to save athlete.");
        return;
      }

      try {
        if (athleteData.id) {
          // Update existing athlete
          // Use the 'appId' variable here
          const athleteRef = doc(db, `artifacts/${appId}/users/${userId}/athletes`, athleteData.id);
          const { isEditable, ...dataToSave } = athleteData;
          await updateDoc(athleteRef, { ...dataToSave });
          console.log(`AthleteProfiles: Athlete ${athleteData.name}'s profile updated successfully!`);
          showCustomModal(`${athleteData.name}'s profile updated successfully!`);
        } else {
          // Add new athlete - always starts as pending
          // Use the 'appId' variable here
          const newAthleteRef = doc(collection(db, `artifacts/${appId}/users/${userId}/athletes`));
          await setDoc(newAthleteRef, { ...athleteData, id: newAthleteRef.id, isApproved: false });
          console.log(`AthleteProfiles: Athlete ${athleteData.name} added successfully! Awaiting approval.`);
          showCustomModal(`${athleteData.name} added successfully! Awaiting approval.`);
        }
        setEditingAthlete(null);
        setViewingAthlete(null);
        setIsAddingNew(false);
      } catch (error) {
        console.error("AthleteProfiles: Error saving athlete:", error);
        showCustomModal(`Failed to save athlete: ${error.message}`);
      }
    };

    const handleCancelEdit = () => {
      setEditingAthlete(null);
      setViewingAthlete(null);
      setIsAddingNew(false);
    };

    const handleAddNewAthlete = () => {
      console.log("AthleteProfiles: Starting new athlete creation.");
      setIsAddingNew(true);
      setEditingAthlete({
        id: '',
        name: '',
        teams: [],
        classes: [],
        skills: [],
        improvementAreas: '',
        coachNotes: [],
        parentName: '',
        parentPhone: '',
        parentEmail: '',
        emergencyContactName: '',
        emergencyContactPhone: '',
        isApproved: false,
        addedByCoach: '',
        profilePicture: null, // Initialize profile picture for new athlete
      });
      setViewingAthlete(null);
    };

    const handleEditAthlete = (athlete) => {
      showConfirmWithInputModal(
        "Enter MASTER passcode to edit:",
        (enteredPasscode) => {
          if (enteredPasscode === MASTER_PASSCODE) {
            setEditingAthlete(athlete);
            setViewingAthlete(null);
            setIsAddingNew(false);
            console.log("AthleteProfiles: Correct passcode, enabling edit for athlete:", athlete.name);
          } else {
            console.warn("AthleteProfiles: Incorrect MASTER passcode for athlete edit.");
            showCustomModal("Incorrect MASTER passcode. You do not have permission to edit.");
          }
        },
        () => { /* do nothing on cancel */ }
      );
    };

    const handleViewAthlete = (athlete) => {
      setViewingAthlete(athlete);
      setEditingAthlete(null);
      setIsAddingNew(false);
      console.log("AthleteProfiles: Viewing athlete:", athlete.name);
    };

    const handleApproveAthlete = (athlete) => {
      showConfirmWithInputModal(
        `Approve ${athlete.name}? Enter MASTER passcode:`,
        async (enteredPasscode) => {
          if (enteredPasscode === MASTER_PASSCODE) {
            try {
              // Use the 'appId' variable here
              const athleteRef = doc(db, `artifacts/${appId}/users/${userId}/athletes`, athlete.id);
              await updateDoc(athleteRef, { isApproved: true });
              console.log("AthleteProfiles: Athlete approved successfully!");
              showCustomModal(`${athlete.name} approved successfully!`);
            } catch (error) {
              console.error("AthleteProfiles: Error approving athlete:", error);
              showCustomModal(`Failed to approve athlete: ${error.message}`);
            }
          } else {
            console.warn("AthleteProfiles: Incorrect MASTER passcode for athlete approval.");
            showCustomModal("Incorrect MASTER passcode. Approval denied.");
          }
        },
        () => { /* do nothing on cancel */ }
      );
    };


    return (
      <div className="flex-grow flex flex-col p-4 bg-gray-50 rounded-lg shadow-inner">
        <h3 className="text-2xl font-bold text-gray-700 mb-4 text-center">Athlete Profiles</h3>

        {/* Search and Add New */}
        <div className="flex flex-col sm:flex-row justify-between items-center mb-6 space-y-4 sm:space-y-0">
          <input
            type="text"
            placeholder="Search approved athletes by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="p-3 border border-gray-300 rounded-md shadow-sm w-full sm:w-1/2 focus:ring-blue-500 focus:border-blue-500 text-gray-800"
          />
          <button
            onClick={handleAddNewAthlete}
            className="px-6 py-3 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-700 transition duration-300 ease-in-out font-semibold flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
            </svg>
            Add New Athlete
          </button>
        </div>

        {/* Pending Athletes Section */}
        {pendingAthletes.length > 0 && (
          <div className="bg-yellow-50 rounded-lg shadow-inner p-4 mb-6 border border-yellow-200">
            <h4 className="text-xl font-semibold text-yellow-800 mb-4">Pending Athletes for Approval</h4>
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white rounded-lg shadow overflow-hidden">
                <thead className="bg-yellow-100 border-b border-yellow-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Athlete Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Added By</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pendingAthletes.map(athlete => (
                    <tr key={athlete.id} className="hover:bg-yellow-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{athlete.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{athlete.addedByCoach || 'N/A'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleApproveAthlete(athlete)}
                            className="text-green-600 hover:text-green-900 transition duration-200"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleEditAthlete(athlete)}
                            className="ml-4 text-indigo-600 hover:text-indigo-900 transition duration-200"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}


        {/* Athlete List or Detail View */}
        {(editingAthlete || viewingAthlete || isAddingNew) ? (
          <AthleteProfileDetail
            key={editingAthlete?.id || 'new-athlete-form'}
            athlete={editingAthlete || viewingAthlete}
            teams={teams}
            classes={classes}
            onSave={handleSaveAthlete}
            onCancel={handleCancelEdit}
            readOnly={!editingAthlete}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white rounded-lg shadow overflow-hidden">
              <thead className="bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Athlete Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Teams</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Classes</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredAthletes.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="px-6 py-4 text-center text-gray-500">No approved athletes found.</td>
                  </tr>
                ) : (
                  filteredAthletes.map(athlete => (
                    <tr key={athlete.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{athlete.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {athlete.teams && athlete.teams.join(', ')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {athlete.classes && athlete.classes.join(', ')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleViewAthlete(athlete)}
                            className="text-blue-600 hover:text-blue-900 transition duration-200"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleEditAthlete(athlete)}
                            className="text-indigo-600 hover:text-indigo-900 transition duration-200"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // --- TagsInput Component for multi-select (Touch Friendly) ---
  const TagsInput = ({ label, options, selectedOptions, onChange, readOnly }) => {
      const handleTagClick = (tag) => {
          if (readOnly) return;
          const newSelection = selectedOptions.includes(tag)
              ? selectedOptions.filter(item => item !== tag)
              : [...selectedOptions, tag];
          onChange(newSelection);
      };

      return (
          <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
              <div className="flex flex-wrap gap-2 p-2 border border-gray-300 rounded-md bg-white min-h-[40px]">
                  {options.map(option => (
                      <button
                          key={option}
                          type="button"
                          onClick={() => handleTagClick(option)}
                          disabled={readOnly}
                          className={`px-4 py-1 rounded-full text-sm font-semibold transition-colors duration-200 ${
                              selectedOptions.includes(option)
                                  ? 'bg-indigo-600 text-white shadow-md'
                                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          } ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                          {option}
                          {selectedOptions.includes(option) && !readOnly && (
                              <span className="ml-1 text-xs">x</span>
                          )}
                      </button>
                  ))}
              </div>
              {!readOnly && <p className="text-xs text-gray-500 mt-1">Tap to add or remove.</p>}
          </div>
      );
  };


  // --- AthleteProfileDetail Component ---
  const AthleteProfileDetail = ({ athlete, teams, classes, onSave, onCancel, readOnly = false }) => {
    const { showCustomModal, coaches } = useFirebase();

    const initialAthleteRef = useRef(athlete); // Ref to hold the initial athlete prop

    const [currentAthlete, setCurrentAthlete] = useState(() => {
        // Initialize state from the prop when the component mounts or when a new athlete is explicitly set via `key`
        return initialAthleteRef.current || {
            id: '', name: '', teams: [], classes: [], skills: [], improvementAreas: '', coachNotes: [],
            parentName: '', parentPhone: '', parentEmail: '', emergencyContactName: '', emergencyContactPhone: '',
            isApproved: false, addedByCoach: '', profilePicture: null // Initialize profile picture for new athlete
        };
    });

    // When the 'athlete' prop changes (due to parent passing a new athlete or clearing it for 'add new'),
    // update the internal state and clear form fields.
    useEffect(() => {
        // Check if the actual athlete object has changed.
        // This is crucial because `athlete` prop might change object reference on parent re-renders
        // without the underlying data logically changing, which would would cause unwanted resets.
        if (initialAthleteRef.current !== athlete) {
            setCurrentAthlete(athlete || {
                id: '', name: '', teams: [], classes: [], skills: [], improvementAreas: '', coachNotes: [],
                parentName: '', parentPhone: '', parentEmail: '', emergencyContactName: '', emergencyContactPhone: '',
                isApproved: false, addedByCoach: '', profilePicture: null
            });
            initialAthleteRef.current = athlete; // Update ref to the new prop

            // Clear coach note and skill input fields when switching athlete or adding new
            setNewNote('');
            setNewSkillName('');
            setNewSkillStatus('Not Started');
        }
    }, [athlete]); // Dependency is the `athlete` prop.

    // Separate state for addedByCoach to prevent overwriting during typing
    const [addedByCoach, setAddedByCoach] = useState(athlete?.addedByCoach || '');

    // Sync addedByCoach state when athlete prop changes
    useEffect(() => {
      setAddedByCoach(athlete?.addedByCoach || '');
    }, [athlete]);


    const [newSkillName, setNewSkillName] = useState('');
    const [newSkillStatus, setNewSkillStatus] = useState('Not Started');
    const [newNote, setNewNote] = useState('');
    const [selectedCoachForNote, setSelectedCoachForNote] = useState('');

    // --- Camera States and Refs ---
    const [cameraMode, setCameraMode] = useState(false); // true for camera, false for file upload
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [stream, setStream] = useState(null);
    const [cameraLoading, setCameraLoading] = useState(false);


    const approvedCoaches = coaches.filter(coach => coach.isApproved);

    // Set default selected coach for note only when approvedCoaches changes or on initial mount.
    useEffect(() => {
      if (approvedCoaches.length > 0) {
        if (!selectedCoachForNote || !approvedCoaches.some(coach => coach.name === selectedCoachForNote)) {
          setSelectedCoachForNote(approvedCoaches[0].name);
        }
      } else {
        setSelectedCoachForNote(''); // Clear if no approved coaches
      }
    }, [approvedCoaches, selectedCoachForNote]);


    // Handle changes for text inputs
    const handleChange = (e) => {
      const { name, value } = e.target;
      setCurrentAthlete(prev => ({ ...prev, [name]: value }));
    };

    // Handle changes for multiselect (teams/classes)
    const handleMultiSelectChange = (newSelection, field) => {
      if (readOnly) return;
      setCurrentAthlete(prev => ({ ...prev, [field]: newSelection }));
    };

    // Handle image upload (from file input)
    const handleImageUpload = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setCurrentAthlete(prev => ({ ...prev, profilePicture: reader.result })); // Store Base64 string
        };
        reader.readAsDataURL(file);
      } else {
        setCurrentAthlete(prev => ({ ...prev, profilePicture: null }));
      }
    };

    // --- Camera Functions ---
    const startCamera = async () => {
      if (readOnly) return;
      setCameraLoading(true);
      try {
        // Request camera access
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play();
        }
        setStream(mediaStream);
        setCameraLoading(false);
      } catch (err) {
        console.error("Error accessing camera:", err);
        let errorMessage = "Failed to access camera. ";
        if (err.name === "NotFoundError" || err.name === "NotReadableError") {
          errorMessage += "No camera found or it's in use by another application.";
        } else if (err.name === "NotAllowedError" || err.name === "SecurityError") {
          errorMessage += "Camera access was denied. Please check your browser's site permissions.";
        } else {
          errorMessage += `Error: ${err.message}`;
        }
        showCustomModal(errorMessage + " You can still use 'Upload Photo' to select an image from your device.");
        setCameraLoading(false);
        setCameraMode(false); // Fallback to file upload mode on error
      }
    };

    const stopCamera = () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
    };

    const takePhoto = () => {
      if (readOnly) return;
      if (videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        // Set canvas dimensions to match video dimensions
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Draw the current frame from the video onto the canvas
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Get the image data from the canvas as a Base64 URL
        const imageDataURL = canvas.toDataURL('image/png'); // Can be 'image/jpeg' for smaller size

        setCurrentAthlete(prev => ({ ...prev, profilePicture: imageDataURL }));
        stopCamera(); // Stop camera after taking photo
      }
    };

    // Effect to start/stop camera when cameraMode changes
    useEffect(() => {
      if (cameraMode && !readOnly) {
        startCamera();
      } else {
        stopCamera();
      }
      // Cleanup on component unmount
      return () => {
        stopCamera();
      };
    }, [cameraMode, readOnly]); // Rerun if cameraMode or readOnly changes

    // Handle skill addition
    const handleAddSkill = () => {
      if (readOnly) return;
      if (newSkillName.trim()) {
        setCurrentAthlete(prev => ({
          ...prev,
          skills: [...(prev.skills || []), { name: newSkillName.trim(), status: newSkillStatus }]
        }));
        setNewSkillName('');
        setNewSkillStatus('Not Started');
      }
    };

    // Handle skill update
    const handleSkillUpdate = (index, field, value) => {
      if (readOnly) return;
      const updatedSkills = [...currentAthlete.skills];
      updatedSkills[index][field] = value;
      setCurrentAthlete(prev => ({ ...prev, skills: updatedSkills }));
    };

    // Handle skill deletion
    const handleRemoveSkill = (indexToRemove) => {
      if (readOnly) return;
      setCurrentAthlete(prev => ({
        ...prev,
        skills: prev.skills.filter((_, index) => index !== indexToRemove)
      }));
    };

    // Handle note addition
    const handleAddNote = () => {
      if (!newNote.trim()) {
        showCustomModal("Please enter text for the note.");
        return;
      }
      if (!selectedCoachForNote) {
        showCustomModal("Please select a coach from the dropdown. If no coaches are listed, ensure coaches are added and approved in 'Coach Management'.");
        return;
      }

      setCurrentAthlete(prev => ({
        ...prev,
        coachNotes: [...(prev.coachNotes || []), { timestamp: Timestamp.now(), note: newNote.trim(), coachName: selectedCoachForNote }]
      }));
      setNewNote('');
    };

    // Validate required fields before saving
    const validateAndSave = () => {
      if (!currentAthlete.name) {
        showCustomModal("Athlete Name is required.");
        return;
      }
      // For new athletes, addedByCoach is required if approved coaches exist
      if (!athlete?.id && !addedByCoach && approvedCoaches.length > 0) {
        showCustomModal("Please select the coach who added this athlete.");
        return;
      }

      const athleteToSave = { ...currentAthlete };
      // Add addedByCoach only when creating a new athlete
      if (!athleteToSave.id) {
        athleteToSave.addedByCoach = addedByCoach;
      }
      onSave(athleteToSave);
    };

    return (
      <div className="bg-white rounded-lg shadow-xl p-6 border border-gray-200">
        <h3 className="text-2xl font-bold text-indigo-700 mb-6 text-center">
          {readOnly ? `Viewing ${athlete.name}'s Profile` : (athlete?.id ? `Edit ${athlete.name}'s Profile` : 'Add New Athlete')}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Basic Info */}
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <h4 className="text-xl font-semibold text-gray-800 mb-4">Basic Information</h4>
            <div className="mb-4 text-center">
              <label className="block text-sm font-medium text-gray-700 mb-1">Profile Picture</label>
              {currentAthlete.profilePicture ? (
                <div className="mb-2 w-32 h-32 rounded-full overflow-hidden mx-auto border-2 border-gray-300 flex items-center justify-center bg-gray-200">
                  <img src={currentAthlete.profilePicture} alt="Profile" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="mb-2 w-32 h-32 rounded-full overflow-hidden mx-auto border-2 border-gray-300 flex items-center justify-center bg-gray-200 text-gray-500 text-sm">
                  No Picture
                </div>
              )}
              {!readOnly && (
                <div className="mt-2">
                  {/* Toggle between file upload and camera */}
                  <div className="flex justify-center space-x-2 mb-3">
                    <button
                      type="button"
                      onClick={() => { setCameraMode(false); stopCamera(); }} // Stop camera when switching to upload
                      className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-200 ${
                        !cameraMode ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Upload Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraMode(true)}
                      className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-200 ${
                        cameraMode ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Take Selfie
                    </button>
                  </div>

                  {cameraMode ? (
                    <>
                      {cameraLoading ? (
                        <div className="flex flex-col items-center justify-center h-32">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                          <p className="mt-2 text-sm text-gray-600">Starting camera...</p>
                        </div>
                      ) : (
                        <>
                          {stream ? (
                            <>
                              <video ref={videoRef} autoPlay playsInline muted className="w-full max-w-xs mx-auto rounded-lg shadow-md mb-2 block" style={{transform: 'scaleX(-1)'}}></video>
                              <canvas ref={canvasRef} className="hidden"></canvas> {/* Hidden canvas for photo capture */}
                              <button
                                type="button"
                                onClick={takePhoto}
                                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition duration-200 mt-2"
                              >
                                Capture Photo
                              </button>
                            </>
                          ) : (
                            <p className="text-sm text-red-500 text-center">
                              Camera not active. Please ensure camera permissions are granted for your browser/site and no other application is using the camera.
                              <br/>Try switching to "Upload Photo" if issues persist.
                            </p>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 mt-2"
                    />
                  )}
                  {currentAthlete.profilePicture && (
                    <button
                      type="button"
                      onClick={() => setCurrentAthlete(prev => ({ ...prev, profilePicture: null }))}
                      className="mt-2 px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition duration-200 text-sm"
                    >
                      Remove Photo
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="mb-4">
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Athlete Name *</label>
              <input
                type="text"
                id="name"
                name="name"
                value={currentAthlete.name || ''}
                onChange={handleChange}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                readOnly={readOnly}
                required
              />
            </div>

            {!athlete?.id && ( // Only show 'Added By Coach' for new athlete creation
              <div className="mb-4">
                <label htmlFor="addedByCoach" className="block text-sm font-medium text-gray-700 mb-1">Added By Coach *</label>
                <select
                  id="addedByCoach"
                  name="addedByCoach"
                  value={addedByCoach}
                  onChange={(e) => setAddedByCoach(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  required={!athlete?.id && approvedCoaches.length > 0}
                  disabled={approvedCoaches.length === 0}
                >
                  {approvedCoaches.length === 0 ? (
                    <option value="">No approved coaches available. Add coaches in 'Coach Management' tab.</option>
                  ) : (
                    <>
                      <option value="">Select Coach</option>
                      {approvedCoaches.map(coach => (
                        <option key={coach.id || coach.name} value={coach.name}>{coach.name}</option>
                      ))}
                    </>
                  )}
                </select>
              </div>
            )}


            {/* Teams Input (Always Tags) */}
            <TagsInput
              label="Teams"
              options={teams}
              selectedOptions={currentAthlete.teams || []}
              onChange={(newSelection) => handleMultiSelectChange(newSelection, 'teams')}
              readOnly={readOnly}
            />

            {/* Classes Input (Always Tags) */}
            <TagsInput
              label="Classes"
              options={classes}
              selectedOptions={currentAthlete.classes || []}
              onChange={(newSelection) => handleMultiSelectChange(newSelection, 'classes')}
              readOnly={readOnly}
            />
          </div>

          {/* Contact Info */}
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <h4 className="text-xl font-semibold text-gray-800 mb-4">Contact Information</h4>
            <div className="mb-4">
              <label htmlFor="parentName" className="block text-sm font-medium text-gray-700 mb-1">Parent/Guardian Name</label>
              <input
                type="text"
                id="parentName"
                name="parentName"
                value={currentAthlete.parentName || ''}
                onChange={handleChange}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                readOnly={readOnly}
              />
            </div>
            <div className="mb-4">
              <label htmlFor="parentPhone" className="block text-sm font-medium text-gray-700 mb-1">Parent/Guardian Phone</label>
              <input
                type="tel"
                id="parentPhone"
                name="parentPhone"
                value={formatPhoneNumber(currentAthlete.parentPhone || '')}
                onChange={(e) => handleChange({ target: { name: 'parentPhone', value: formatPhoneNumber(e.target.value) } })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="###-###-####"
                readOnly={readOnly}
              />
            </div>
            <div className="mb-4">
              <label htmlFor="parentEmail" className="block text-sm font-medium text-gray-700 mb-1">Parent/Guardian Email</label>
              <input
                type="email"
                id="parentEmail"
                name="parentEmail"
                value={currentAthlete.parentEmail || ''}
                onChange={handleChange}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                readOnly={readOnly}
              />
            </div>
            <div className="mb-4">
              <label htmlFor="emergencyContactName" className="block text-sm font-medium text-gray-700 mb-1">Emergency Contact Name</label>
              <input
                type="text"
                id="emergencyContactName"
                name="emergencyContactName"
                value={currentAthlete.emergencyContactName || ''}
                onChange={handleChange}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                readOnly={readOnly}
              />
            </div>
            <div>
              <label htmlFor="emergencyContactPhone" className="block text-sm font-medium text-gray-700 mb-1">Emergency Contact Phone</label>
              <input
                type="tel"
                id="emergencyContactPhone"
                name="emergencyContactPhone"
                value={formatPhoneNumber(currentAthlete.emergencyContactPhone || '')}
                onChange={(e) => handleChange({ target: { name: 'emergencyContactPhone', value: formatPhoneNumber(e.target.value) } })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="###-###-####"
                readOnly={readOnly}
              />
            </div>
          </div>
        </div>

        {/* Skills Section */}
        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 mb-6">
          <h4 className="text-xl font-semibold text-gray-800 mb-4">Skills</h4>
          {!readOnly && (
            <div className="mb-4">
              <label htmlFor="newSkillName" className="block text-sm font-medium text-gray-700 mb-1">Add New Skill</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  id="newSkillName"
                  placeholder="Skill Name (e.g., Back Handspring)"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  className="flex-grow p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
                <select
                  value={newSkillStatus}
                  onChange={(e) => setNewSkillStatus(e.target.value)}
                  className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="Not Started">Not Started</option>
                  <option value="Working On">Working On</option>
                  <option value="Needs Improvement">Needs Improvement</option>
                  <option value="Mastered">Mastered</option>
                </select>
                <button
                  onClick={handleAddSkill}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition duration-200"
                >
                  Add
                </button>
              </div>
            </div>
          )}
          {currentAthlete.skills && currentAthlete.skills.length > 0 ? (
            <ul className="space-y-2">
              {currentAthlete.skills.map((skill, index) => (
                <li key={index} className="flex items-center space-x-2 bg-white p-3 rounded-md shadow-sm border border-gray-100">
                  <input
                    type="text"
                    value={skill.name}
                    onChange={(e) => handleSkillUpdate(index, 'name', e.target.value)}
                    className="flex-grow p-1 border border-gray-300 rounded-md text-sm"
                    readOnly={readOnly}
                  />
                  <select
                    value={skill.status}
                    onChange={(e) => handleSkillUpdate(index, 'status', e.target.value)}
                    className="p-1 border border-gray-300 rounded-md text-sm"
                    disabled={readOnly}
                  >
                    <option value="Not Started">Not Started</option>
                    <option value="Working On">Working On</option>
                    <option value="Needs Improvement">Needs Improvement</option>
                    <option value="Mastered">Mastered</option>
                  </select>
                  {!readOnly && (
                    <button
                      onClick={() => handleRemoveSkill(index)}
                      className="text-red-500 hover:text-red-700 transition duration-200"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm1 4a1 1 0 100 2h4a1 1 0 100-2H8z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-600 text-sm">No skills added yet.</p>
          )}
        </div>

        {/* Improvement Areas */}
        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 mb-6">
          <h4 className="text-xl font-semibold text-gray-800 mb-4">Improvement Areas</h4>
          <textarea
            name="improvementAreas"
            value={currentAthlete.improvementAreas || ''}
            onChange={handleChange}
            rows="3"
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Notes on specific areas for improvement..."
            readOnly={readOnly}
          ></textarea>
        </div>

        {/* Coach Notes */}
        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 mb-6">
          <h4 className="text-xl font-semibold text-gray-800 mb-4">Coach Notes</h4>
          {/* This section remains interactive regardless of readOnly status */}
          <div className="mb-4">
            <label htmlFor="coachSelector" className="block text-sm font-medium text-gray-700 mb-1">Coach</label>
            <select
              id="coachSelector"
              value={selectedCoachForNote}
              onChange={(e) => setSelectedCoachForNote(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500 mb-2"
            >
              {approvedCoaches.length === 0 ? (
                <option value="">No approved coaches available</option>
              ) : (
                <>
                  <option value="">Select Coach</option>
                  {approvedCoaches.map(coach => (
                        <option key={coach.id || coach.name} value={coach.name}>{coach.name}</option>
                      ))}
                    </>
                  )}
                </select>

                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows="2"
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Add a new note..."
                ></textarea>
                <button
                  onClick={handleAddNote}
                  className="mt-2 px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 transition duration-200"
                >
                  Add Note
                </button>
              </div>
              {currentAthlete.coachNotes && currentAthlete.coachNotes.length > 0 ? (
                <ul className="space-y-2 max-h-40 overflow-y-auto">
                  {currentAthlete.coachNotes
                    .sort((a, b) => b.timestamp.toDate() - a.timestamp.toDate())
                    .map((noteObj, index) => (
                      <li key={index} className="bg-white p-3 rounded-md shadow-sm border border-gray-100">
                        <p className="text-xs text-gray-500 mb-1">
                          <span className="font-semibold text-gray-700">{noteObj.coachName || 'Unknown Coach'}</span> - {noteObj.timestamp ? new Date(noteObj.timestamp.toDate()).toLocaleString() : 'N/A'}
                        </p>
                        <p className="text-sm text-gray-800">{noteObj.note}</p>
                        {!readOnly && (
                          <button
                            onClick={() => {
                              const updatedNotes = currentAthlete.coachNotes.filter((_, i) => i !== index);
                              setCurrentAthlete(prev => ({ ...prev, coachNotes: updatedNotes }));
                            }}
                            className="text-red-500 hover:text-red-700 text-sm mt-1 float-right"
                          >
                            Delete Note
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-gray-600 text-sm">No coach notes available.</p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-4 mt-6">
              <button
                onClick={onCancel}
                className="px-6 py-3 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 transition duration-200 font-semibold"
              >
                {readOnly ? 'Close View' : 'Cancel'}
              </button>
              {!readOnly && (
                <button
                  onClick={validateAndSave}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition duration-200 font-semibold"
                >
                  Save Profile
                </button>
              )}
            </div>
          </div>
        );
      };

export default App;
