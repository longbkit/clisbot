// Hub › Account, sign-in, CLI login, welcome and the Hub sidebar.
// `en` is the source; every locale carries the same keys (resources.test.ts checks it).
const en = {
  errors: {
    notIncluded: "Hub support is not included in this build.",
    pairFirst: "Pair a Hub first.",
    requestFailed: "Hub request failed.",
    requestFailedStatus: "Hub request failed ({{status}}).",
    signInFirst: "Sign in to Hub first.",
    unavailable: "Hub is unavailable.",
    registrationFailed: "Hub registration request failed ({{status}}).",
    saveFailed: "Hub couldn't save the change ({{status}}).",
    invalidProfileName: "Enter a name of up to 100 characters.",
    invalidProfileImage:
      "Use an https image link from a host this Hub trusts, such as a Google or Gravatar photo.",
    invalidOrganizationName: "Enter an organization name of up to 100 characters.",
    organizationOwnerRequired: "Only an organization owner can rename the organization.",
  },
  googleSignIn: {
    registrationClosed:
      "This Google account isn't admitted to this Hub. Use an invited address or an allowed company domain.",
    emailUnverified: "Google hasn't verified this email address, so Hub can't use it.",
    linkedToDifferentAccount:
      "This Google account is linked to a different Hub account. Ask the Hub operator to recover it.",
    profileUnavailable:
      "Google didn't return the profile Hub needs. Try signing in with Google again.",
    instanceUnavailable:
      "This Hub was already set up by someone else. Sign in with your account instead.",
    unableToLink:
      "Hub doesn't link Google to this account automatically. Sign in with your password.",
    accountNotLinked:
      "An account with this email exists, but Google couldn't prove the address. Sign in with your password.",
  },
  signIn: {
    canceled: "Hub sign-in was canceled.",
    noRefreshToken: "Hub did not issue a refresh token.",
    credentialExchangeFailed: "Hub credential exchange failed ({{status}}).",
    emailAndPasswordRequired: "Email and password are required.",
    googleStartFailed: "Hub couldn't start Google sign-in.",
    signOutFailed: "Hub sign-out failed.",
    browserOriginRequired:
      "Browser Hub access requires the Clisbot client to be served from the Hub origin.",
    desktopBridgeUnavailable: "Desktop Hub bridge is unavailable.",
    desktopSignInUnavailable: "Desktop Hub sign-in is unavailable.",
    desktopSignOutUnavailable: "Desktop Hub sign-out is unavailable.",
    notAdmitted:
      "This account isn't admitted to this Hub. Ask an organization owner to invite you.",
    incorrectCredentials: "The email or password is incorrect.",
    stateMismatch: "Hub sign-in state mismatch.",
    unexpectedIssuer: "Unexpected Hub issuer.",
    failed: "Hub sign-in failed: {{error}}",
    noAuthorizationCode: "Hub did not return an authorization code.",
  },
  roles: {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
  },
  welcome: {
    addAnotherHub: "+ Add another Hub",
    oneHubPerApp: "One Hub per app for now.",
    setUpHub: "Set up Hub",
    description: "Sign in to use the Hosts and Projects your organization shares with you.",
    whatIsHub: "What is a Hub?",
    signIn: "Sign in to Hub",
    continueWithGoogle: "Continue with Google",
    useEmailAndPassword: "Use email and password instead",
    actions: {
      account: "Account",
      refreshHosts: "Refresh Hosts",
      retry: "Retry",
    },
    badges: {
      actionNeeded: "Action needed",
      error: "Error",
      loading: "Loading",
      noHost: "No Host",
    },
    steps: {
      organizationRequired: "Choose an organization to continue.",
      appSetupRequired: "Finish setting up this app to continue.",
      passwordChangeRequired: "Change your password to continue.",
      finishSigningIn: "Open Account to finish signing in.",
    },
    connectFailed: "Couldn't connect {{label}}: {{message}}",
    hostsFailed: "Clisbot could not load the Hosts your organization shares.",
    loadingHosts: "Loading the Hosts your organization shares…",
    noHostCanAdd:
      "No Host shared with you yet. Run `clisbot hub connect` on the computer you want to use, or connect one of your own below.",
    noHostAskAccess:
      "No Host shared with you yet. Ask an organization owner or admin for access, or connect one of your own below.",
    hostConnected: "{{label}} is connected.",
    connectingTo: "Connecting to {{label}}…",
    hostHint: "{{label}}: {{hint}}",
    cannotReach: "Clisbot can't reach {{label}}.",
  },
  hostStatus: {
    online: "Online",
    onlineDescription: "Ready for Projects and Agents",
    connecting: "Connecting",
    connectingDescription: "Clisbot is connecting to this Host",
    waiting: "Waiting for connection",
    unavailable: "Status unavailable",
    offline: "Offline",
    failed: "Connection failed",
    unreachableDescription:
      "Clisbot can't reach this Host. Reconnect, or check its daemon on that computer:",
    registering: "Registering",
    registeringDescription: "Clisbot is adding this Daemon as a Host",
    offerOffline:
      "This Host is not connected to Hub. Start Clisbot on that computer and check clisbot hub status, then refresh Hosts.",
    offerConnected:
      "This Host is connected to Hub but has not shared connection details. Check that relay is enabled on that computer, then refresh Hosts.",
    offerUnavailable:
      "This Host's connection status is unavailable. Check clisbot hub status on that computer, then refresh Hosts.",
  },
  hostRow: {
    hostId: "Host ID: {{id}}",
    hubId: "Hub ID: {{id}}",
    copy: "Copy",
    disconnect: "Disconnect",
    disconnected: "Disconnected",
    actionsFor: "Actions for {{label}}",
    retry: "Retry",
    addProject: "Add project",
    openHost: "Open Host",
    reconnect: "Reconnect",
    connections: "Connections",
  },
  synchronization: {
    conflictWithHint:
      "A saved Host conflicts with this Hub's connection details. Check the Host's Connections settings.",
    conflict: "A saved Host conflicts with this Hub's connection details.",
    addFailed: "Unable to add this Host to Clisbot.",
    renameFailed: "Unable to update the Host name.",
  },
  copyCommand: {
    copy: "Copy command",
    copied: "Copied",
    failed: "Unable to copy command.",
  },
  nextSteps: {
    newBot: "New bot",
    title: "What would you like to do next?",
    hint: "Choose a next step, or continue to Home.",
    createBot: "Create a Bot",
    createBotDescription: "Give an assistant a role and its own workspace.",
    addProject: "Add a Project",
    addProjectDescription: "Work with documents or code in a folder on this Host.",
    addHost: "Add another Host",
    addHostDescription: "Connect another computer through Hub or directly.",
    managedHost: "Add managed Host via Hub",
    directHost: "Connect a direct Host",
    continueHome: "Continue to Home",
  },
  cliLogin: {
    home: "Home",
    settings: "Settings",
    connectHost: "Connect Host",
    advancedAccess: "Advanced CLI access",
    approveRequest: "Approve a terminal request",
    verificationCode: "Verification code",
    verificationHint: "Only approve a code you requested yourself.",
    continue: "Continue",
    connectHostTitle: "Connect host",
    hostAdded: "{{label}} was added to Clisbot",
    hostOnline: "The Host is online. Choose what to do next, or continue to the app.",
    hostConnecting: "The Host was added and Clisbot is connecting to it.",
    openHosts: "Open Hosts",
    hostNotDetected: "Connection approved; Host not detected",
    connectionApproved: "Host connection approved",
    hostNotDetectedDescription:
      "Open Hosts to check the connection. If it is missing, check the daemon logs, then retry discovery.",
    connectionApprovedDescription:
      "Clisbot is connecting the approved Host automatically. Let the terminal command finish; this page follows the connection.",
    retry: "Retry",
    waitingForHost: "Waiting for the enrolled host...",
    checking: "Checking the request...",
    requestUnavailable: "Request unavailable",
    requestUnavailableDescription:
      "Check the code and Hub connection, or run the terminal command again from the terminal if the request expired.",
    enterAnotherCode: "Enter another code",
    decisionFailed: "Could not record the decision",
    decisionError: "Unable to record CLI login decision.",
    deny: "Deny",
    approveFor: "Approve for {{organization}}",
    approvalRequired: "Owner or admin approval required",
    approvalRequiredDescription:
      "An organization owner or admin must approve this request. Sign in with an account that can manage this organization.",
    openAccount: "Open account",
    denied: "Request denied",
    deniedDescription: "You can close this window and return to the terminal.",
    loginApproved: "CLI login approved",
    loginApprovedDescription:
      "Return to the terminal. This grants organization API access; it does not add a Host. Use hub connect to add a Host.",
  },
  cliSummary: {
    connectHostEyebrow: "Connect Host to organization",
    advancedAccessEyebrow: "Advanced CLI access for organization",
    organizationId: "Organization ID",
    approvedBy: "Approved by",
    hub: "Hub",
    code: "Code",
    codeHint: "Must match the code in your terminal",
    requestExpires: "Request expires",
    host: "Host",
    hostId: "Host ID",
    hostPublicKey: "Host public key",
    allowHost: "Allow {{organization}} to use this Host",
    actFor: "This CLI will act for {{organization}}",
    hostPermissions:
      "Hub permissions on this Host: {{permissions}}.\n\nApproval allows one enrollment of this Host before the request expires. The Host then keeps its own connection credential. No CLI administration credential is created. Disconnect the Host to remove its local connection, or revoke it in Hub.",
    noPermissions: "None",
    credentialNotice:
      "The credential has no automatic expiry. An owner or admin must revoke it in Hub → Configuration → API keys. CLI logout only removes its local copy. Use hub connect for Host onboarding.",
    impacts: {
      listProjects: "List Projects and read their configuration",
      installTriggers: "Install triggers and configuration",
      enrollHosts: "Enroll Hosts; each enrolled Host joins this organization",
      startRuns: "Start Automation runs",
    },
  },
  connectionResults: {
    githubApprovalRequired: {
      title: "GitHub owner approval required",
      description:
        "Ask a GitHub organization owner to approve this installation, then connect again.",
    },
    slackBotFailed: {
      title: "Slack permissions are incomplete",
      description:
        "Apply the setup guide's manifest in Slack, then install again. Hub did not save this Connection.",
    },
    providerNotConfigured: {
      title: "Provider application required",
      description: "Verify and save the Provider Application before connecting an account.",
    },
    connectionInvalid: {
      title: "Connection link unavailable",
      description:
        "This setup link expired or was already used. Start Connect account again below.",
    },
    connectionConflict: {
      title: "Account connected elsewhere",
      description:
        "Disconnect the provider account from its other organization, or choose a different account.",
    },
    completed: {
      title: "{{provider}} setup completed",
      description:
        "The provider returned from setup. The refreshed list below shows the current Connection status.",
    },
    cancelled: {
      title: "{{provider}} setup cancelled",
      description: "Start Connect account again when you are ready.",
    },
  },
  continuation: {
    openFailed: "The provider page could not open. Use Continue setup to try again.",
  },
  sidebar: {
    organization: "Hub organization: {{name}}",
    personalHub: "Personal Hub",
    personalHubSettings: "Personal Hub settings",
    hubAccount: "Hub account",
    accountLabel: "Hub account: {{label}}",
    signIn: "Sign in",
    hubUnavailable: "Hub unavailable",
    signInToAccount: "Sign in to your account",
  },
} as const;

type HubAccountCopy = typeof en;
type Translation<T> = { [K in keyof T]: T[K] extends string ? string : Translation<T[K]> };

const ar: Translation<HubAccountCopy> = {
  errors: {
    notIncluded: "دعم Hub غير مضمَّن في هذا الإصدار.",
    pairFirst: "أقرِن Hub أولًا.",
    requestFailed: "فشل طلب Hub.",
    requestFailedStatus: "فشل طلب Hub ({{status}}).",
    signInFirst: "سجّل الدخول إلى Hub أولًا.",
    unavailable: "Hub غير متاح.",
    registrationFailed: "فشل طلب التسجيل في Hub ({{status}}).",
    saveFailed: "تعذّر على Hub حفظ التغيير ({{status}}).",
    invalidProfileName: "أدخل اسمًا لا يتجاوز 100 حرف.",
    invalidProfileImage:
      "استخدم رابط صورة https من مضيف يثق به هذا الـHub، مثل صورة من Google أو Gravatar.",
    invalidOrganizationName: "أدخل اسم مؤسسة لا يتجاوز 100 حرف.",
    organizationOwnerRequired: "يمكن لمالك المؤسسة فقط إعادة تسمية المؤسسة.",
  },
  googleSignIn: {
    registrationClosed:
      "حساب Google هذا غير مقبول في هذا الـHub. استخدم عنوانًا مدعوًّا أو نطاق شركة مسموحًا به.",
    emailUnverified: "لم يتحقق Google من عنوان البريد الإلكتروني هذا، لذا لا يمكن لـHub استخدامه.",
    linkedToDifferentAccount: "حساب Google هذا مرتبط بحساب Hub آخر. اطلب من مشغّل الـHub استعادته.",
    profileUnavailable:
      "لم يُرجع Google الملف الشخصي الذي يحتاجه Hub. حاول تسجيل الدخول باستخدام Google مرة أخرى.",
    instanceUnavailable: "أعدّ شخص آخر هذا الـHub بالفعل. سجّل الدخول بحسابك بدلًا من ذلك.",
    unableToLink: "لا يربط Hub حساب Google بهذا الحساب تلقائيًا. سجّل الدخول بكلمة المرور.",
    accountNotLinked:
      "يوجد حساب بهذا البريد الإلكتروني، لكن Google لم يتمكن من إثبات العنوان. سجّل الدخول بكلمة المرور.",
  },
  signIn: {
    canceled: "أُلغي تسجيل الدخول إلى Hub.",
    noRefreshToken: "لم يُصدر Hub رمز تحديث.",
    credentialExchangeFailed: "فشل تبادل بيانات الاعتماد مع Hub ({{status}}).",
    emailAndPasswordRequired: "البريد الإلكتروني وكلمة المرور مطلوبان.",
    googleStartFailed: "تعذّر على Hub بدء تسجيل الدخول باستخدام Google.",
    signOutFailed: "فشل تسجيل الخروج من Hub.",
    browserOriginRequired: "يتطلب الوصول إلى Hub من المتصفح أن يُقدَّم عميل Clisbot من أصل الـHub.",
    desktopBridgeUnavailable: "جسر Hub لسطح المكتب غير متاح.",
    desktopSignInUnavailable: "تسجيل الدخول إلى Hub من سطح المكتب غير متاح.",
    desktopSignOutUnavailable: "تسجيل الخروج من Hub على سطح المكتب غير متاح.",
    notAdmitted: "هذا الحساب غير مقبول في هذا الـHub. اطلب من مالك المؤسسة دعوتك.",
    incorrectCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    stateMismatch: "عدم تطابق حالة تسجيل الدخول إلى Hub.",
    unexpectedIssuer: "جهة إصدار Hub غير متوقعة.",
    failed: "فشل تسجيل الدخول إلى Hub: {{error}}",
    noAuthorizationCode: "لم يُرجع Hub رمز تفويض.",
  },
  roles: {
    owner: "المالك",
    admin: "المسؤول",
    member: "عضو",
  },
  welcome: {
    addAnotherHub: "+ إضافة Hub آخر",
    oneHubPerApp: "Hub واحد لكل تطبيق حاليًا.",
    setUpHub: "إعداد Hub",
    description: "سجّل الدخول لاستخدام المضيفين والمشاريع التي تشاركها مؤسستك معك.",
    whatIsHub: "ما هو Hub؟",
    signIn: "تسجيل الدخول إلى Hub",
    continueWithGoogle: "المتابعة باستخدام Google",
    useEmailAndPassword: "استخدام البريد الإلكتروني وكلمة المرور بدلًا من ذلك",
    actions: {
      account: "الحساب",
      refreshHosts: "تحديث المضيفين",
      retry: "إعادة المحاولة",
    },
    badges: {
      actionNeeded: "يلزم إجراء",
      error: "خطأ",
      loading: "جارٍ التحميل",
      noHost: "لا يوجد مضيف",
    },
    steps: {
      organizationRequired: "اختر مؤسسة للمتابعة.",
      appSetupRequired: "أكمل إعداد هذا التطبيق للمتابعة.",
      passwordChangeRequired: "غيّر كلمة المرور للمتابعة.",
      finishSigningIn: "افتح الحساب لإكمال تسجيل الدخول.",
    },
    connectFailed: "تعذّر توصيل {{label}}: {{message}}",
    hostsFailed: "تعذّر على Clisbot تحميل المضيفين الذين تشاركهم مؤسستك.",
    loadingHosts: "جارٍ تحميل المضيفين الذين تشاركهم مؤسستك…",
    noHostCanAdd:
      "لم تتم مشاركة أي مضيف معك بعد. شغّل `clisbot hub connect` على الكمبيوتر الذي تريد استخدامه، أو وصّل أحد أجهزتك أدناه.",
    noHostAskAccess:
      "لم تتم مشاركة أي مضيف معك بعد. اطلب الوصول من مالك المؤسسة أو مسؤولها، أو وصّل أحد أجهزتك أدناه.",
    hostConnected: "{{label}} متصل.",
    connectingTo: "جارٍ الاتصال بـ {{label}}…",
    hostHint: "{{label}}: {{hint}}",
    cannotReach: "لا يستطيع Clisbot الوصول إلى {{label}}.",
  },
  hostStatus: {
    online: "متصل",
    onlineDescription: "جاهز للمشاريع والوكلاء",
    connecting: "جارٍ الاتصال",
    connectingDescription: "يتصل Clisbot بهذا المضيف",
    waiting: "في انتظار الاتصال",
    unavailable: "الحالة غير متاحة",
    offline: "غير متصل",
    failed: "فشل الاتصال",
    unreachableDescription:
      "لا يستطيع Clisbot الوصول إلى هذا المضيف. أعد الاتصال، أو تحقق من البرنامج الخفي على ذلك الكمبيوتر:",
    registering: "جارٍ التسجيل",
    registeringDescription: "يضيف Clisbot هذا البرنامج الخفي كمضيف",
    offerOffline:
      "هذا المضيف غير متصل بـHub. شغّل Clisbot على ذلك الكمبيوتر وتحقق من clisbot hub status، ثم حدّث المضيفين.",
    offerConnected:
      "هذا المضيف متصل بـHub لكنه لم يشارك تفاصيل الاتصال. تحقق من تفعيل relay على ذلك الكمبيوتر، ثم حدّث المضيفين.",
    offerUnavailable:
      "حالة اتصال هذا المضيف غير متاحة. تحقق من clisbot hub status على ذلك الكمبيوتر، ثم حدّث المضيفين.",
  },
  hostRow: {
    hostId: "معرّف المضيف: {{id}}",
    hubId: "معرّف Hub: {{id}}",
    copy: "نسخ",
    disconnect: "قطع الاتصال",
    disconnected: "تم قطع الاتصال",
    actionsFor: "إجراءات {{label}}",
    retry: "إعادة المحاولة",
    addProject: "إضافة مشروع",
    openHost: "فتح المضيف",
    reconnect: "إعادة الاتصال",
    connections: "الاتصالات",
  },
  synchronization: {
    conflictWithHint:
      "يتعارض مضيف محفوظ مع تفاصيل اتصال هذا الـHub. تحقق من إعدادات اتصالات المضيف.",
    conflict: "يتعارض مضيف محفوظ مع تفاصيل اتصال هذا الـHub.",
    addFailed: "تعذّرت إضافة هذا المضيف إلى Clisbot.",
    renameFailed: "تعذّر تحديث اسم المضيف.",
  },
  copyCommand: {
    copy: "نسخ الأمر",
    copied: "تم النسخ",
    failed: "تعذّر نسخ الأمر.",
  },
  nextSteps: {
    newBot: "بوت جديد",
    title: "ماذا تريد أن تفعل بعد ذلك؟",
    hint: "اختر خطوة تالية، أو تابع إلى الرئيسية.",
    createBot: "إنشاء بوت",
    createBotDescription: "امنح مساعدًا دورًا ومساحة عمل خاصة به.",
    addProject: "إضافة مشروع",
    addProjectDescription: "اعمل على مستندات أو تعليمات برمجية في مجلد على هذا المضيف.",
    addHost: "إضافة مضيف آخر",
    addHostDescription: "وصّل كمبيوترًا آخر عبر Hub أو مباشرة.",
    managedHost: "إضافة مضيف مُدار عبر Hub",
    directHost: "توصيل مضيف مباشر",
    continueHome: "المتابعة إلى الرئيسية",
  },
  cliLogin: {
    home: "الرئيسية",
    settings: "الإعدادات",
    connectHost: "توصيل مضيف",
    advancedAccess: "وصول CLI متقدم",
    approveRequest: "الموافقة على طلب من الطرفية",
    verificationCode: "رمز التحقق",
    verificationHint: "وافق فقط على رمز طلبته بنفسك.",
    continue: "متابعة",
    connectHostTitle: "توصيل مضيف",
    hostAdded: "تمت إضافة {{label}} إلى Clisbot",
    hostOnline: "المضيف متصل. اختر ما تريد فعله بعد ذلك، أو تابع إلى التطبيق.",
    hostConnecting: "تمت إضافة المضيف ويتصل Clisbot به.",
    openHosts: "فتح المضيفين",
    hostNotDetected: "تمت الموافقة على الاتصال؛ لم يُكتشف المضيف",
    connectionApproved: "تمت الموافقة على اتصال المضيف",
    hostNotDetectedDescription:
      "افتح المضيفين للتحقق من الاتصال. إذا كان مفقودًا، فتحقق من سجلات البرنامج الخفي، ثم أعد محاولة الاكتشاف.",
    connectionApprovedDescription:
      "يوصّل Clisbot المضيف الذي تمت الموافقة عليه تلقائيًا. اترك أمر الطرفية يكتمل؛ تتابع هذه الصفحة الاتصال.",
    retry: "إعادة المحاولة",
    waitingForHost: "في انتظار المضيف المسجَّل...",
    checking: "جارٍ التحقق من الطلب...",
    requestUnavailable: "الطلب غير متاح",
    requestUnavailableDescription:
      "تحقق من الرمز ومن اتصال Hub، أو شغّل أمر الطرفية مرة أخرى من الطرفية إذا انتهت صلاحية الطلب.",
    enterAnotherCode: "إدخال رمز آخر",
    decisionFailed: "تعذّر تسجيل القرار",
    decisionError: "تعذّر تسجيل قرار تسجيل الدخول عبر CLI.",
    deny: "رفض",
    approveFor: "الموافقة لـ {{organization}}",
    approvalRequired: "تلزم موافقة المالك أو المسؤول",
    approvalRequiredDescription:
      "يجب أن يوافق مالك المؤسسة أو مسؤولها على هذا الطلب. سجّل الدخول بحساب يمكنه إدارة هذه المؤسسة.",
    openAccount: "فتح الحساب",
    denied: "تم رفض الطلب",
    deniedDescription: "يمكنك إغلاق هذه النافذة والعودة إلى الطرفية.",
    loginApproved: "تمت الموافقة على تسجيل الدخول عبر CLI",
    loginApprovedDescription:
      "عد إلى الطرفية. يمنح هذا وصولًا إلى API المؤسسة؛ ولا يضيف مضيفًا. استخدم hub connect لإضافة مضيف.",
  },
  cliSummary: {
    connectHostEyebrow: "توصيل مضيف بالمؤسسة",
    advancedAccessEyebrow: "وصول CLI متقدم للمؤسسة",
    organizationId: "معرّف المؤسسة",
    approvedBy: "وافق عليه",
    hub: "Hub",
    code: "الرمز",
    codeHint: "يجب أن يطابق الرمز في الطرفية",
    requestExpires: "تنتهي صلاحية الطلب",
    host: "المضيف",
    hostId: "معرّف المضيف",
    hostPublicKey: "المفتاح العام للمضيف",
    allowHost: "السماح لـ {{organization}} باستخدام هذا المضيف",
    actFor: "سيعمل هذا الـCLI نيابةً عن {{organization}}",
    hostPermissions:
      "أذونات Hub على هذا المضيف: {{permissions}}.\n\nتسمح الموافقة بتسجيل واحد لهذا المضيف قبل انتهاء صلاحية الطلب. بعد ذلك يحتفظ المضيف ببيانات اعتماد الاتصال الخاصة به. لا يتم إنشاء بيانات اعتماد لإدارة CLI. افصل المضيف لإزالة اتصاله المحلي، أو ألغه في Hub.",
    noPermissions: "لا شيء",
    credentialNotice:
      "ليس لبيانات الاعتماد انتهاء صلاحية تلقائي. يجب أن يلغيها مالك أو مسؤول في Hub ← الإعداد ← مفاتيح API. تسجيل الخروج من CLI يزيل نسختها المحلية فقط. استخدم hub connect لإعداد المضيف.",
    impacts: {
      listProjects: "عرض المشاريع وقراءة إعداداتها",
      installTriggers: "تثبيت المشغّلات والإعدادات",
      enrollHosts: "تسجيل المضيفين؛ ينضم كل مضيف مسجَّل إلى هذه المؤسسة",
      startRuns: "بدء تشغيلات الأتمتة",
    },
  },
  connectionResults: {
    githubApprovalRequired: {
      title: "تلزم موافقة مالك GitHub",
      description: "اطلب من مالك مؤسسة GitHub الموافقة على هذا التثبيت، ثم اتصل مرة أخرى.",
    },
    slackBotFailed: {
      title: "أذونات Slack غير مكتملة",
      description:
        "طبّق ملف البيان من دليل الإعداد في Slack، ثم ثبّت مرة أخرى. لم يحفظ Hub هذا الاتصال.",
    },
    providerNotConfigured: {
      title: "يلزم تطبيق المزوّد",
      description: "تحقق من تطبيق المزوّد واحفظه قبل ربط حساب.",
    },
    connectionInvalid: {
      title: "رابط الاتصال غير متاح",
      description: "انتهت صلاحية رابط الإعداد هذا أو سبق استخدامه. ابدأ ربط الحساب مرة أخرى أدناه.",
    },
    connectionConflict: {
      title: "الحساب مرتبط في مكان آخر",
      description: "افصل حساب المزوّد عن مؤسسته الأخرى، أو اختر حسابًا مختلفًا.",
    },
    completed: {
      title: "اكتمل إعداد {{provider}}",
      description: "عاد المزوّد من الإعداد. تعرض القائمة المحدَّثة أدناه حالة الاتصال الحالية.",
    },
    cancelled: {
      title: "أُلغي إعداد {{provider}}",
      description: "ابدأ ربط الحساب مرة أخرى عندما تكون مستعدًا.",
    },
  },
  continuation: {
    openFailed: "تعذّر فتح صفحة المزوّد. استخدم متابعة الإعداد للمحاولة مرة أخرى.",
  },
  sidebar: {
    organization: "مؤسسة Hub: {{name}}",
    personalHub: "Hub الشخصي",
    personalHubSettings: "إعدادات Hub الشخصي",
    hubAccount: "حساب Hub",
    accountLabel: "حساب Hub: {{label}}",
    signIn: "تسجيل الدخول",
    hubUnavailable: "الـ Hub غير متاح",
    signInToAccount: "سجّل الدخول إلى حسابك",
  },
};

const es: Translation<HubAccountCopy> = {
  errors: {
    notIncluded: "Esta compilación no incluye compatibilidad con Hub.",
    pairFirst: "Primero vincula un Hub.",
    requestFailed: "La solicitud a Hub falló.",
    requestFailedStatus: "La solicitud a Hub falló ({{status}}).",
    signInFirst: "Primero inicia sesión en Hub.",
    unavailable: "Hub no está disponible.",
    registrationFailed: "La solicitud de registro en Hub falló ({{status}}).",
    saveFailed: "Hub no pudo guardar el cambio ({{status}}).",
    invalidProfileName: "Escribe un nombre de hasta 100 caracteres.",
    invalidProfileImage:
      "Usa un enlace de imagen https de un host en el que confíe este Hub, como una foto de Google o Gravatar.",
    invalidOrganizationName: "Escribe un nombre de organización de hasta 100 caracteres.",
    organizationOwnerRequired: "Solo un propietario de la organización puede cambiarle el nombre.",
  },
  googleSignIn: {
    registrationClosed:
      "Esta cuenta de Google no tiene acceso a este Hub. Usa una dirección invitada o un dominio de empresa permitido.",
    emailUnverified:
      "Google no ha verificado esta dirección de correo, así que Hub no puede usarla.",
    linkedToDifferentAccount:
      "Esta cuenta de Google está vinculada a otra cuenta de Hub. Pide al operador del Hub que la recupere.",
    profileUnavailable:
      "Google no devolvió el perfil que Hub necesita. Vuelve a iniciar sesión con Google.",
    instanceUnavailable:
      "Otra persona ya configuró este Hub. Inicia sesión con tu cuenta en su lugar.",
    unableToLink:
      "Hub no vincula Google a esta cuenta automáticamente. Inicia sesión con tu contraseña.",
    accountNotLinked:
      "Ya existe una cuenta con este correo, pero Google no pudo verificar la dirección. Inicia sesión con tu contraseña.",
  },
  signIn: {
    canceled: "Se canceló el inicio de sesión en Hub.",
    noRefreshToken: "Hub no emitió un token de actualización.",
    credentialExchangeFailed: "Falló el intercambio de credenciales con Hub ({{status}}).",
    emailAndPasswordRequired: "El correo y la contraseña son obligatorios.",
    googleStartFailed: "Hub no pudo iniciar el inicio de sesión con Google.",
    signOutFailed: "No se pudo cerrar la sesión en Hub.",
    browserOriginRequired:
      "El acceso a Hub desde el navegador requiere que el cliente de Clisbot se sirva desde el origen del Hub.",
    desktopBridgeUnavailable: "El puente de Hub de escritorio no está disponible.",
    desktopSignInUnavailable: "El inicio de sesión en Hub de escritorio no está disponible.",
    desktopSignOutUnavailable: "El cierre de sesión en Hub de escritorio no está disponible.",
    notAdmitted:
      "Esta cuenta no tiene acceso a este Hub. Pide a un propietario de la organización que te invite.",
    incorrectCredentials: "El correo o la contraseña no son correctos.",
    stateMismatch: "El estado del inicio de sesión en Hub no coincide.",
    unexpectedIssuer: "Emisor de Hub inesperado.",
    failed: "Falló el inicio de sesión en Hub: {{error}}",
    noAuthorizationCode: "Hub no devolvió un código de autorización.",
  },
  roles: {
    owner: "Propietario",
    admin: "Administrador",
    member: "Miembro",
  },
  welcome: {
    addAnotherHub: "+ Añadir otro Hub",
    oneHubPerApp: "Por ahora, un Hub por app.",
    setUpHub: "Configurar Hub",
    description:
      "Inicia sesión para usar los Hosts y Proyectos que tu organización comparte contigo.",
    whatIsHub: "¿Qué es un Hub?",
    signIn: "Iniciar sesión en Hub",
    continueWithGoogle: "Continuar con Google",
    useEmailAndPassword: "Usar correo y contraseña",
    actions: {
      account: "Cuenta",
      refreshHosts: "Actualizar Hosts",
      retry: "Reintentar",
    },
    badges: {
      actionNeeded: "Acción necesaria",
      error: "Error",
      loading: "Cargando",
      noHost: "Sin Host",
    },
    steps: {
      organizationRequired: "Elige una organización para continuar.",
      appSetupRequired: "Termina de configurar esta app para continuar.",
      passwordChangeRequired: "Cambia tu contraseña para continuar.",
      finishSigningIn: "Abre Cuenta para terminar de iniciar sesión.",
    },
    connectFailed: "No se pudo conectar {{label}}: {{message}}",
    hostsFailed: "Clisbot no pudo cargar los Hosts que comparte tu organización.",
    loadingHosts: "Cargando los Hosts que comparte tu organización…",
    noHostCanAdd:
      "Todavía no se ha compartido ningún Host contigo. Ejecuta `clisbot hub connect` en el equipo que quieras usar, o conecta uno propio abajo.",
    noHostAskAccess:
      "Todavía no se ha compartido ningún Host contigo. Pide acceso a un propietario o administrador de la organización, o conecta uno propio abajo.",
    hostConnected: "{{label}} está conectado.",
    connectingTo: "Conectando con {{label}}…",
    hostHint: "{{label}}: {{hint}}",
    cannotReach: "Clisbot no puede llegar a {{label}}.",
  },
  hostStatus: {
    online: "En línea",
    onlineDescription: "Listo para Proyectos y Agentes",
    connecting: "Conectando",
    connectingDescription: "Clisbot se está conectando a este Host",
    waiting: "Esperando conexión",
    unavailable: "Estado no disponible",
    offline: "Desconectado",
    failed: "Error de conexión",
    unreachableDescription:
      "Clisbot no puede llegar a este Host. Vuelve a conectar o revisa su demonio en ese equipo:",
    registering: "Registrando",
    registeringDescription: "Clisbot está añadiendo este demonio como Host",
    offerOffline:
      "Este Host no está conectado a Hub. Inicia Clisbot en ese equipo y revisa clisbot hub status; después, actualiza los Hosts.",
    offerConnected:
      "Este Host está conectado a Hub pero no ha compartido los datos de conexión. Comprueba que el relay esté activado en ese equipo; después, actualiza los Hosts.",
    offerUnavailable:
      "El estado de conexión de este Host no está disponible. Revisa clisbot hub status en ese equipo; después, actualiza los Hosts.",
  },
  hostRow: {
    hostId: "ID del Host: {{id}}",
    hubId: "ID en Hub: {{id}}",
    copy: "Copiar",
    disconnect: "Desconectar",
    disconnected: "Desconectado",
    actionsFor: "Acciones para {{label}}",
    retry: "Reintentar",
    addProject: "Añadir proyecto",
    openHost: "Abrir Host",
    reconnect: "Volver a conectar",
    connections: "Conexiones",
  },
  synchronization: {
    conflictWithHint:
      "Un Host guardado entra en conflicto con los datos de conexión de este Hub. Revisa los ajustes de Conexiones del Host.",
    conflict: "Un Host guardado entra en conflicto con los datos de conexión de este Hub.",
    addFailed: "No se pudo añadir este Host a Clisbot.",
    renameFailed: "No se pudo actualizar el nombre del Host.",
  },
  copyCommand: {
    copy: "Copiar comando",
    copied: "Copiado",
    failed: "No se pudo copiar el comando.",
  },
  nextSteps: {
    newBot: "Nuevo bot",
    title: "¿Qué quieres hacer ahora?",
    hint: "Elige un siguiente paso o continúa al Inicio.",
    createBot: "Crear un Bot",
    createBotDescription: "Dale a un asistente un rol y su propio espacio de trabajo.",
    addProject: "Añadir un Proyecto",
    addProjectDescription: "Trabaja con documentos o código en una carpeta de este Host.",
    addHost: "Añadir otro Host",
    addHostDescription: "Conecta otro equipo a través de Hub o directamente.",
    managedHost: "Añadir Host gestionado por Hub",
    directHost: "Conectar un Host directo",
    continueHome: "Continuar al Inicio",
  },
  cliLogin: {
    home: "Inicio",
    settings: "Ajustes",
    connectHost: "Conectar Host",
    advancedAccess: "Acceso avanzado a la CLI",
    approveRequest: "Aprobar una solicitud del terminal",
    verificationCode: "Código de verificación",
    verificationHint: "Aprueba solo un código que hayas solicitado tú.",
    continue: "Continuar",
    connectHostTitle: "Conectar host",
    hostAdded: "Se añadió {{label}} a Clisbot",
    hostOnline: "El Host está en línea. Elige qué hacer ahora o continúa a la app.",
    hostConnecting: "Se añadió el Host y Clisbot se está conectando a él.",
    openHosts: "Abrir Hosts",
    hostNotDetected: "Conexión aprobada; no se detectó el Host",
    connectionApproved: "Conexión del Host aprobada",
    hostNotDetectedDescription:
      "Abre Hosts para revisar la conexión. Si falta, revisa los registros del demonio y vuelve a intentar la detección.",
    connectionApprovedDescription:
      "Clisbot está conectando automáticamente el Host aprobado. Deja que termine el comando del terminal; esta página sigue la conexión.",
    retry: "Reintentar",
    waitingForHost: "Esperando al host registrado...",
    checking: "Comprobando la solicitud...",
    requestUnavailable: "Solicitud no disponible",
    requestUnavailableDescription:
      "Revisa el código y la conexión con Hub, o vuelve a ejecutar el comando en el terminal si la solicitud caducó.",
    enterAnotherCode: "Introducir otro código",
    decisionFailed: "No se pudo registrar la decisión",
    decisionError: "No se pudo registrar la decisión de inicio de sesión de la CLI.",
    deny: "Denegar",
    approveFor: "Aprobar para {{organization}}",
    approvalRequired: "Se requiere aprobación de un propietario o administrador",
    approvalRequiredDescription:
      "Un propietario o administrador de la organización debe aprobar esta solicitud. Inicia sesión con una cuenta que pueda gestionar esta organización.",
    openAccount: "Abrir cuenta",
    denied: "Solicitud denegada",
    deniedDescription: "Puedes cerrar esta ventana y volver al terminal.",
    loginApproved: "Inicio de sesión de la CLI aprobado",
    loginApprovedDescription:
      "Vuelve al terminal. Esto concede acceso a la API de la organización; no añade un Host. Usa hub connect para añadir un Host.",
  },
  cliSummary: {
    connectHostEyebrow: "Conectar Host a la organización",
    advancedAccessEyebrow: "Acceso avanzado a la CLI para la organización",
    organizationId: "ID de la organización",
    approvedBy: "Aprobado por",
    hub: "Hub",
    code: "Código",
    codeHint: "Debe coincidir con el código de tu terminal",
    requestExpires: "La solicitud caduca",
    host: "Host",
    hostId: "ID del Host",
    hostPublicKey: "Clave pública del Host",
    allowHost: "Permitir que {{organization}} use este Host",
    actFor: "Esta CLI actuará en nombre de {{organization}}",
    hostPermissions:
      "Permisos de Hub en este Host: {{permissions}}.\n\nLa aprobación permite un único registro de este Host antes de que caduque la solicitud. Después, el Host conserva su propia credencial de conexión. No se crea ninguna credencial de administración de la CLI. Desconecta el Host para quitar su conexión local, o revócala en Hub.",
    noPermissions: "Ninguno",
    credentialNotice:
      "La credencial no caduca automáticamente. Un propietario o administrador debe revocarla en Hub → Configuración → Claves de API. Cerrar sesión en la CLI solo elimina su copia local. Usa hub connect para incorporar Hosts.",
    impacts: {
      listProjects: "Listar Proyectos y leer su configuración",
      installTriggers: "Instalar disparadores y configuración",
      enrollHosts: "Registrar Hosts; cada Host registrado se une a esta organización",
      startRuns: "Iniciar ejecuciones de Automatizaciones",
    },
  },
  connectionResults: {
    githubApprovalRequired: {
      title: "Se requiere aprobación del propietario de GitHub",
      description:
        "Pide a un propietario de la organización de GitHub que apruebe esta instalación y vuelve a conectar.",
    },
    slackBotFailed: {
      title: "Los permisos de Slack están incompletos",
      description:
        "Aplica el manifiesto de la guía de configuración en Slack y vuelve a instalar. Hub no guardó esta Conexión.",
    },
    providerNotConfigured: {
      title: "Se requiere una aplicación del proveedor",
      description: "Verifica y guarda la aplicación del proveedor antes de conectar una cuenta.",
    },
    connectionInvalid: {
      title: "Enlace de conexión no disponible",
      description:
        "Este enlace de configuración caducó o ya se usó. Vuelve a iniciar Conectar cuenta abajo.",
    },
    connectionConflict: {
      title: "Cuenta conectada en otro lugar",
      description:
        "Desconecta la cuenta del proveedor de su otra organización o elige otra cuenta.",
    },
    completed: {
      title: "Configuración de {{provider}} completada",
      description:
        "El proveedor volvió de la configuración. La lista actualizada de abajo muestra el estado actual de la Conexión.",
    },
    cancelled: {
      title: "Configuración de {{provider}} cancelada",
      description: "Vuelve a iniciar Conectar cuenta cuando estés listo.",
    },
  },
  continuation: {
    openFailed:
      "No se pudo abrir la página del proveedor. Usa Continuar configuración para reintentarlo.",
  },
  sidebar: {
    organization: "Organización de Hub: {{name}}",
    personalHub: "Hub personal",
    personalHubSettings: "Ajustes del Hub personal",
    hubAccount: "Cuenta de Hub",
    accountLabel: "Cuenta de Hub: {{label}}",
    signIn: "Iniciar sesión",
    hubUnavailable: "Hub no disponible",
    signInToAccount: "Inicia sesión en tu cuenta",
  },
};

const fr: Translation<HubAccountCopy> = {
  errors: {
    notIncluded: "La prise en charge de Hub n’est pas incluse dans cette version.",
    pairFirst: "Associez d’abord un Hub.",
    requestFailed: "La requête Hub a échoué.",
    requestFailedStatus: "La requête Hub a échoué ({{status}}).",
    signInFirst: "Connectez-vous d’abord à Hub.",
    unavailable: "Hub est indisponible.",
    registrationFailed: "La demande d’inscription à Hub a échoué ({{status}}).",
    saveFailed: "Hub n’a pas pu enregistrer la modification ({{status}}).",
    invalidProfileName: "Saisissez un nom de 100 caractères au maximum.",
    invalidProfileImage:
      "Utilisez un lien d’image https provenant d’un hôte approuvé par ce Hub, comme une photo Google ou Gravatar.",
    invalidOrganizationName: "Saisissez un nom d’organisation de 100 caractères au maximum.",
    organizationOwnerRequired: "Seul un propriétaire de l’organisation peut la renommer.",
  },
  googleSignIn: {
    registrationClosed:
      "Ce compte Google n’est pas admis sur ce Hub. Utilisez une adresse invitée ou un domaine d’entreprise autorisé.",
    emailUnverified:
      "Google n’a pas vérifié cette adresse e-mail ; Hub ne peut donc pas l’utiliser.",
    linkedToDifferentAccount:
      "Ce compte Google est lié à un autre compte Hub. Demandez à l’opérateur du Hub de le récupérer.",
    profileUnavailable:
      "Google n’a pas renvoyé le profil dont Hub a besoin. Réessayez de vous connecter avec Google.",
    instanceUnavailable:
      "Ce Hub a déjà été configuré par quelqu’un d’autre. Connectez-vous plutôt avec votre compte.",
    unableToLink:
      "Hub ne lie pas automatiquement Google à ce compte. Connectez-vous avec votre mot de passe.",
    accountNotLinked:
      "Un compte existe avec cet e-mail, mais Google n’a pas pu prouver l’adresse. Connectez-vous avec votre mot de passe.",
  },
  signIn: {
    canceled: "La connexion à Hub a été annulée.",
    noRefreshToken: "Hub n’a pas émis de jeton d’actualisation.",
    credentialExchangeFailed: "L’échange d’identifiants avec Hub a échoué ({{status}}).",
    emailAndPasswordRequired: "L’e-mail et le mot de passe sont requis.",
    googleStartFailed: "Hub n’a pas pu lancer la connexion avec Google.",
    signOutFailed: "La déconnexion de Hub a échoué.",
    browserOriginRequired:
      "L’accès à Hub depuis le navigateur exige que le client Clisbot soit servi depuis l’origine du Hub.",
    desktopBridgeUnavailable: "Le pont Hub de l’application de bureau est indisponible.",
    desktopSignInUnavailable: "La connexion à Hub depuis l’application de bureau est indisponible.",
    desktopSignOutUnavailable:
      "La déconnexion de Hub depuis l’application de bureau est indisponible.",
    notAdmitted:
      "Ce compte n’est pas admis sur ce Hub. Demandez à un propriétaire de l’organisation de vous inviter.",
    incorrectCredentials: "L’e-mail ou le mot de passe est incorrect.",
    stateMismatch: "L’état de connexion à Hub ne correspond pas.",
    unexpectedIssuer: "Émetteur Hub inattendu.",
    failed: "La connexion à Hub a échoué : {{error}}",
    noAuthorizationCode: "Hub n’a pas renvoyé de code d’autorisation.",
  },
  roles: {
    owner: "Propriétaire",
    admin: "Administrateur",
    member: "Membre",
  },
  welcome: {
    addAnotherHub: "+ Ajouter un autre Hub",
    oneHubPerApp: "Un seul Hub par application pour l’instant.",
    setUpHub: "Configurer Hub",
    description:
      "Connectez-vous pour utiliser les Hôtes et les Projets que votre organisation partage avec vous.",
    whatIsHub: "Qu’est-ce qu’un Hub ?",
    signIn: "Se connecter à Hub",
    continueWithGoogle: "Continuer avec Google",
    useEmailAndPassword: "Utiliser plutôt l’e-mail et le mot de passe",
    actions: {
      account: "Compte",
      refreshHosts: "Actualiser les Hôtes",
      retry: "Réessayer",
    },
    badges: {
      actionNeeded: "Action requise",
      error: "Erreur",
      loading: "Chargement",
      noHost: "Aucun Hôte",
    },
    steps: {
      organizationRequired: "Choisissez une organisation pour continuer.",
      appSetupRequired: "Terminez la configuration de cette application pour continuer.",
      passwordChangeRequired: "Changez votre mot de passe pour continuer.",
      finishSigningIn: "Ouvrez Compte pour terminer la connexion.",
    },
    connectFailed: "Impossible de connecter {{label}} : {{message}}",
    hostsFailed: "Clisbot n’a pas pu charger les Hôtes partagés par votre organisation.",
    loadingHosts: "Chargement des Hôtes partagés par votre organisation…",
    noHostCanAdd:
      "Aucun Hôte n’a encore été partagé avec vous. Exécutez `clisbot hub connect` sur l’ordinateur que vous voulez utiliser, ou connectez l’un des vôtres ci-dessous.",
    noHostAskAccess:
      "Aucun Hôte n’a encore été partagé avec vous. Demandez l’accès à un propriétaire ou un administrateur de l’organisation, ou connectez l’un des vôtres ci-dessous.",
    hostConnected: "{{label}} est connecté.",
    connectingTo: "Connexion à {{label}}…",
    hostHint: "{{label}} : {{hint}}",
    cannotReach: "Clisbot ne parvient pas à joindre {{label}}.",
  },
  hostStatus: {
    online: "En ligne",
    onlineDescription: "Prêt pour les Projets et les Agents",
    connecting: "Connexion",
    connectingDescription: "Clisbot se connecte à cet Hôte",
    waiting: "En attente de connexion",
    unavailable: "État indisponible",
    offline: "Hors ligne",
    failed: "Échec de la connexion",
    unreachableDescription:
      "Clisbot ne parvient pas à joindre cet Hôte. Reconnectez-le ou vérifiez son démon sur cet ordinateur :",
    registering: "Enregistrement",
    registeringDescription: "Clisbot ajoute ce démon en tant qu’Hôte",
    offerOffline:
      "Cet Hôte n’est pas connecté à Hub. Démarrez Clisbot sur cet ordinateur et vérifiez clisbot hub status, puis actualisez les Hôtes.",
    offerConnected:
      "Cet Hôte est connecté à Hub mais n’a pas partagé ses informations de connexion. Vérifiez que le relais est activé sur cet ordinateur, puis actualisez les Hôtes.",
    offerUnavailable:
      "L’état de connexion de cet Hôte est indisponible. Vérifiez clisbot hub status sur cet ordinateur, puis actualisez les Hôtes.",
  },
  hostRow: {
    hostId: "ID de l’Hôte : {{id}}",
    hubId: "ID Hub : {{id}}",
    copy: "Copier",
    disconnect: "Déconnecter",
    disconnected: "Déconnecté",
    actionsFor: "Actions pour {{label}}",
    retry: "Réessayer",
    addProject: "Ajouter un projet",
    openHost: "Ouvrir l’Hôte",
    reconnect: "Reconnecter",
    connections: "Relations",
  },
  synchronization: {
    conflictWithHint:
      "Un Hôte enregistré entre en conflit avec les informations de connexion de ce Hub. Vérifiez les paramètres Relations de l’Hôte.",
    conflict: "Un Hôte enregistré entre en conflit avec les informations de connexion de ce Hub.",
    addFailed: "Impossible d’ajouter cet Hôte à Clisbot.",
    renameFailed: "Impossible de mettre à jour le nom de l’Hôte.",
  },
  copyCommand: {
    copy: "Copier la commande",
    copied: "Copié",
    failed: "Impossible de copier la commande.",
  },
  nextSteps: {
    newBot: "Nouveau bot",
    title: "Que voulez-vous faire ensuite ?",
    hint: "Choisissez une étape suivante, ou continuez vers l’accueil.",
    createBot: "Créer un Bot",
    createBotDescription: "Donnez à un assistant un rôle et son propre espace de travail.",
    addProject: "Ajouter un Projet",
    addProjectDescription: "Travaillez sur des documents ou du code dans un dossier de cet Hôte.",
    addHost: "Ajouter un autre Hôte",
    addHostDescription: "Connectez un autre ordinateur via Hub ou directement.",
    managedHost: "Ajouter un Hôte géré via Hub",
    directHost: "Connecter un Hôte direct",
    continueHome: "Continuer vers l’accueil",
  },
  cliLogin: {
    home: "Accueil",
    settings: "Paramètres",
    connectHost: "Connecter un Hôte",
    advancedAccess: "Accès CLI avancé",
    approveRequest: "Approuver une demande du terminal",
    verificationCode: "Code de vérification",
    verificationHint: "N’approuvez qu’un code que vous avez demandé vous-même.",
    continue: "Continuer",
    connectHostTitle: "Connecter un hôte",
    hostAdded: "{{label}} a été ajouté à Clisbot",
    hostOnline: "L’Hôte est en ligne. Choisissez la suite, ou continuez vers l’application.",
    hostConnecting: "L’Hôte a été ajouté et Clisbot s’y connecte.",
    openHosts: "Ouvrir les Hôtes",
    hostNotDetected: "Connexion approuvée ; Hôte non détecté",
    connectionApproved: "Connexion de l’Hôte approuvée",
    hostNotDetectedDescription:
      "Ouvrez les Hôtes pour vérifier la connexion. S’il est absent, consultez les journaux du démon, puis relancez la détection.",
    connectionApprovedDescription:
      "Clisbot connecte automatiquement l’Hôte approuvé. Laissez la commande du terminal se terminer ; cette page suit la connexion.",
    retry: "Réessayer",
    waitingForHost: "En attente de l’hôte enregistré...",
    checking: "Vérification de la demande...",
    requestUnavailable: "Demande indisponible",
    requestUnavailableDescription:
      "Vérifiez le code et la connexion au Hub, ou relancez la commande depuis le terminal si la demande a expiré.",
    enterAnotherCode: "Saisir un autre code",
    decisionFailed: "Impossible d’enregistrer la décision",
    decisionError: "Impossible d’enregistrer la décision de connexion CLI.",
    deny: "Refuser",
    approveFor: "Approuver pour {{organization}}",
    approvalRequired: "Approbation d’un propriétaire ou d’un administrateur requise",
    approvalRequiredDescription:
      "Un propriétaire ou un administrateur de l’organisation doit approuver cette demande. Connectez-vous avec un compte qui peut gérer cette organisation.",
    openAccount: "Ouvrir le compte",
    denied: "Demande refusée",
    deniedDescription: "Vous pouvez fermer cette fenêtre et revenir au terminal.",
    loginApproved: "Connexion CLI approuvée",
    loginApprovedDescription:
      "Revenez au terminal. Cela accorde un accès à l’API de l’organisation ; aucun Hôte n’est ajouté. Utilisez hub connect pour ajouter un Hôte.",
  },
  cliSummary: {
    connectHostEyebrow: "Connecter un Hôte à l’organisation",
    advancedAccessEyebrow: "Accès CLI avancé pour l’organisation",
    organizationId: "ID de l’organisation",
    approvedBy: "Approuvé par",
    hub: "Hub",
    code: "Code",
    codeHint: "Doit correspondre au code affiché dans votre terminal",
    requestExpires: "Expiration de la demande",
    host: "Hôte",
    hostId: "ID de l’Hôte",
    hostPublicKey: "Clé publique de l’Hôte",
    allowHost: "Autoriser {{organization}} à utiliser cet Hôte",
    actFor: "Cette CLI agira pour {{organization}}",
    hostPermissions:
      "Autorisations Hub sur cet Hôte : {{permissions}}.\n\nL’approbation permet un seul enregistrement de cet Hôte avant l’expiration de la demande. L’Hôte conserve ensuite son propre identifiant de connexion. Aucun identifiant d’administration CLI n’est créé. Déconnectez l’Hôte pour supprimer sa connexion locale, ou révoquez-la dans Hub.",
    noPermissions: "Aucune",
    credentialNotice:
      "L’identifiant n’expire pas automatiquement. Un propriétaire ou un administrateur doit le révoquer dans Hub → Configuration → Clés d’API. La déconnexion de la CLI ne supprime que sa copie locale. Utilisez hub connect pour intégrer un Hôte.",
    impacts: {
      listProjects: "Lister les Projets et lire leur configuration",
      installTriggers: "Installer des déclencheurs et une configuration",
      enrollHosts: "Enregistrer des Hôtes ; chaque Hôte enregistré rejoint cette organisation",
      startRuns: "Lancer des exécutions d’Automatisations",
    },
  },
  connectionResults: {
    githubApprovalRequired: {
      title: "Approbation du propriétaire GitHub requise",
      description:
        "Demandez à un propriétaire de l’organisation GitHub d’approuver cette installation, puis reconnectez-vous.",
    },
    slackBotFailed: {
      title: "Les autorisations Slack sont incomplètes",
      description:
        "Appliquez le manifeste du guide de configuration dans Slack, puis réinstallez. Hub n’a pas enregistré cette Connexion.",
    },
    providerNotConfigured: {
      title: "Application du fournisseur requise",
      description:
        "Vérifiez et enregistrez l’application du fournisseur avant de connecter un compte.",
    },
    connectionInvalid: {
      title: "Lien de connexion indisponible",
      description:
        "Ce lien de configuration a expiré ou a déjà été utilisé. Relancez Connecter un compte ci-dessous.",
    },
    connectionConflict: {
      title: "Compte connecté ailleurs",
      description:
        "Déconnectez le compte du fournisseur de son autre organisation, ou choisissez un autre compte.",
    },
    completed: {
      title: "Configuration de {{provider}} terminée",
      description:
        "Le fournisseur est revenu de la configuration. La liste actualisée ci-dessous indique l’état actuel de la Connexion.",
    },
    cancelled: {
      title: "Configuration de {{provider}} annulée",
      description: "Relancez Connecter un compte quand vous êtes prêt.",
    },
  },
  continuation: {
    openFailed:
      "La page du fournisseur n’a pas pu s’ouvrir. Utilisez Continuer la configuration pour réessayer.",
  },
  sidebar: {
    organization: "Organisation Hub : {{name}}",
    personalHub: "Hub personnel",
    personalHubSettings: "Paramètres du Hub personnel",
    hubAccount: "Compte Hub",
    accountLabel: "Compte Hub : {{label}}",
    signIn: "Se connecter",
    hubUnavailable: "Hub indisponible",
    signInToAccount: "Connectez-vous à votre compte",
  },
};

const ja: Translation<HubAccountCopy> = {
  errors: {
    notIncluded: "このビルドには Hub のサポートが含まれていません。",
    pairFirst: "先に Hub をペアリングしてください。",
    requestFailed: "Hub へのリクエストに失敗しました。",
    requestFailedStatus: "Hub へのリクエストに失敗しました（{{status}}）。",
    signInFirst: "先に Hub にサインインしてください。",
    unavailable: "Hub を利用できません。",
    registrationFailed: "Hub の登録リクエストに失敗しました（{{status}}）。",
    saveFailed: "Hub で変更を保存できませんでした（{{status}}）。",
    invalidProfileName: "100 文字以内で名前を入力してください。",
    invalidProfileImage:
      "この Hub が信頼するホストの https 画像リンク（Google や Gravatar の写真など）を使用してください。",
    invalidOrganizationName: "100 文字以内で組織名を入力してください。",
    organizationOwnerRequired: "組織名を変更できるのは組織のオーナーだけです。",
  },
  googleSignIn: {
    registrationClosed:
      "この Google アカウントはこの Hub に参加できません。招待されたアドレスか、許可された会社ドメインを使用してください。",
    emailUnverified: "このメールアドレスは Google で確認されていないため、Hub で使用できません。",
    linkedToDifferentAccount:
      "この Google アカウントは別の Hub アカウントにリンクされています。Hub の運用者に復旧を依頼してください。",
    profileUnavailable:
      "Hub に必要なプロフィールが Google から返されませんでした。もう一度 Google でサインインしてください。",
    instanceUnavailable:
      "この Hub はすでに別のユーザーがセットアップしています。ご自身のアカウントでサインインしてください。",
    unableToLink:
      "Hub はこのアカウントに Google を自動でリンクしません。パスワードでサインインしてください。",
    accountNotLinked:
      "このメールアドレスのアカウントは存在しますが、Google でアドレスを確認できませんでした。パスワードでサインインしてください。",
  },
  signIn: {
    canceled: "Hub へのサインインがキャンセルされました。",
    noRefreshToken: "Hub がリフレッシュトークンを発行しませんでした。",
    credentialExchangeFailed: "Hub との認証情報の交換に失敗しました（{{status}}）。",
    emailAndPasswordRequired: "メールアドレスとパスワードが必要です。",
    googleStartFailed: "Hub で Google サインインを開始できませんでした。",
    signOutFailed: "Hub からのサインアウトに失敗しました。",
    browserOriginRequired:
      "ブラウザから Hub にアクセスするには、Clisbot クライアントを Hub のオリジンから配信する必要があります。",
    desktopBridgeUnavailable: "デスクトップの Hub ブリッジを利用できません。",
    desktopSignInUnavailable: "デスクトップから Hub にサインインできません。",
    desktopSignOutUnavailable: "デスクトップから Hub をサインアウトできません。",
    notAdmitted:
      "このアカウントはこの Hub に参加できません。組織のオーナーに招待を依頼してください。",
    incorrectCredentials: "メールアドレスまたはパスワードが正しくありません。",
    stateMismatch: "Hub のサインイン状態が一致しません。",
    unexpectedIssuer: "予期しない Hub の発行者です。",
    failed: "Hub へのサインインに失敗しました: {{error}}",
    noAuthorizationCode: "Hub が認可コードを返しませんでした。",
  },
  roles: {
    owner: "オーナー",
    admin: "管理者",
    member: "メンバー",
  },
  welcome: {
    addAnotherHub: "+ 別の Hub を追加",
    oneHubPerApp: "現在は 1 つのアプリにつき 1 つの Hub です。",
    setUpHub: "Hub をセットアップ",
    description: "サインインすると、組織が共有しているホストとプロジェクトを使用できます。",
    whatIsHub: "Hub とは？",
    signIn: "Hub にサインイン",
    continueWithGoogle: "Google で続行",
    useEmailAndPassword: "メールアドレスとパスワードを使用",
    actions: {
      account: "アカウント",
      refreshHosts: "ホストを更新",
      retry: "再試行",
    },
    badges: {
      actionNeeded: "対応が必要",
      error: "エラー",
      loading: "読み込み中",
      noHost: "ホストなし",
    },
    steps: {
      organizationRequired: "続行するには組織を選択してください。",
      appSetupRequired: "続行するにはこのアプリのセットアップを完了してください。",
      passwordChangeRequired: "続行するにはパスワードを変更してください。",
      finishSigningIn: "アカウントを開いてサインインを完了してください。",
    },
    connectFailed: "{{label}} に接続できませんでした: {{message}}",
    hostsFailed: "組織が共有しているホストを Clisbot で読み込めませんでした。",
    loadingHosts: "組織が共有しているホストを読み込んでいます…",
    noHostCanAdd:
      "まだ共有されたホストはありません。使用するコンピューターで `clisbot hub connect` を実行するか、下からご自身のホストを接続してください。",
    noHostAskAccess:
      "まだ共有されたホストはありません。組織のオーナーまたは管理者にアクセスを依頼するか、下からご自身のホストを接続してください。",
    hostConnected: "{{label}} に接続しました。",
    connectingTo: "{{label}} に接続しています…",
    hostHint: "{{label}}: {{hint}}",
    cannotReach: "Clisbot は {{label}} に到達できません。",
  },
  hostStatus: {
    online: "オンライン",
    onlineDescription: "プロジェクトとエージェントを使用できます",
    connecting: "接続中",
    connectingDescription: "Clisbot がこのホストに接続しています",
    waiting: "接続を待機中",
    unavailable: "状態を取得できません",
    offline: "オフライン",
    failed: "接続に失敗しました",
    unreachableDescription:
      "Clisbot はこのホストに到達できません。再接続するか、そのコンピューターのデーモンを確認してください:",
    registering: "登録中",
    registeringDescription: "Clisbot がこのデーモンをホストとして追加しています",
    offerOffline:
      "このホストは Hub に接続されていません。そのコンピューターで Clisbot を起動して clisbot hub status を確認してから、ホストを更新してください。",
    offerConnected:
      "このホストは Hub に接続されていますが、接続情報を共有していません。そのコンピューターでリレーが有効になっていることを確認してから、ホストを更新してください。",
    offerUnavailable:
      "このホストの接続状態を取得できません。そのコンピューターで clisbot hub status を確認してから、ホストを更新してください。",
  },
  hostRow: {
    hostId: "ホスト ID: {{id}}",
    hubId: "Hub ID: {{id}}",
    copy: "コピー",
    disconnect: "切断",
    disconnected: "切断済み",
    actionsFor: "{{label}} の操作",
    retry: "再試行",
    addProject: "プロジェクトを追加",
    openHost: "ホストを開く",
    reconnect: "再接続",
    connections: "接続",
  },
  synchronization: {
    conflictWithHint:
      "保存済みのホストがこの Hub の接続情報と競合しています。ホストの接続設定を確認してください。",
    conflict: "保存済みのホストがこの Hub の接続情報と競合しています。",
    addFailed: "このホストを Clisbot に追加できませんでした。",
    renameFailed: "ホスト名を更新できませんでした。",
  },
  copyCommand: {
    copy: "コマンドをコピー",
    copied: "コピーしました",
    failed: "コマンドをコピーできませんでした。",
  },
  nextSteps: {
    newBot: "新しいボット",
    title: "次に何をしますか？",
    hint: "次のステップを選ぶか、ホームに進んでください。",
    createBot: "ボットを作成",
    createBotDescription: "アシスタントに役割と専用のワークスペースを与えます。",
    addProject: "プロジェクトを追加",
    addProjectDescription: "このホスト上のフォルダーでドキュメントやコードを扱います。",
    addHost: "別のホストを追加",
    addHostDescription: "Hub 経由または直接、別のコンピューターを接続します。",
    managedHost: "Hub 経由で管理対象ホストを追加",
    directHost: "直接接続のホストを接続",
    continueHome: "ホームに進む",
  },
  cliLogin: {
    home: "ホーム",
    settings: "設定",
    connectHost: "ホストを接続",
    advancedAccess: "高度な CLI アクセス",
    approveRequest: "ターミナルからのリクエストを承認",
    verificationCode: "確認コード",
    verificationHint: "ご自身でリクエストしたコードだけを承認してください。",
    continue: "続行",
    connectHostTitle: "ホストを接続",
    hostAdded: "{{label}} を Clisbot に追加しました",
    hostOnline: "ホストはオンラインです。次に行うことを選ぶか、アプリに進んでください。",
    hostConnecting: "ホストを追加しました。Clisbot が接続しています。",
    openHosts: "ホストを開く",
    hostNotDetected: "接続は承認されましたが、ホストが検出されません",
    connectionApproved: "ホストの接続を承認しました",
    hostNotDetectedDescription:
      "ホストを開いて接続を確認してください。見つからない場合は、デーモンのログを確認してから検出を再試行してください。",
    connectionApprovedDescription:
      "Clisbot が承認済みのホストを自動で接続しています。ターミナルのコマンドが完了するまでお待ちください。このページは接続の状況を追跡します。",
    retry: "再試行",
    waitingForHost: "登録されたホストを待機しています...",
    checking: "リクエストを確認しています...",
    requestUnavailable: "リクエストを利用できません",
    requestUnavailableDescription:
      "コードと Hub への接続を確認してください。リクエストの有効期限が切れた場合は、ターミナルからコマンドをもう一度実行してください。",
    enterAnotherCode: "別のコードを入力",
    decisionFailed: "決定を記録できませんでした",
    decisionError: "CLI ログインの決定を記録できませんでした。",
    deny: "拒否",
    approveFor: "{{organization}} として承認",
    approvalRequired: "オーナーまたは管理者の承認が必要です",
    approvalRequiredDescription:
      "このリクエストは組織のオーナーまたは管理者が承認する必要があります。この組織を管理できるアカウントでサインインしてください。",
    openAccount: "アカウントを開く",
    denied: "リクエストを拒否しました",
    deniedDescription: "このウィンドウを閉じて、ターミナルに戻ってかまいません。",
    loginApproved: "CLI ログインを承認しました",
    loginApprovedDescription:
      "ターミナルに戻ってください。これにより組織の API へのアクセスが許可されますが、ホストは追加されません。ホストを追加するには hub connect を使用してください。",
  },
  cliSummary: {
    connectHostEyebrow: "ホストを組織に接続",
    advancedAccessEyebrow: "組織の高度な CLI アクセス",
    organizationId: "組織 ID",
    approvedBy: "承認者",
    hub: "Hub",
    code: "コード",
    codeHint: "ターミナルに表示されたコードと一致する必要があります",
    requestExpires: "リクエストの有効期限",
    host: "ホスト",
    hostId: "ホスト ID",
    hostPublicKey: "ホストの公開鍵",
    allowHost: "{{organization}} にこのホストの使用を許可",
    actFor: "この CLI は {{organization}} として動作します",
    hostPermissions:
      "このホストでの Hub の権限: {{permissions}}。\n\n承認すると、リクエストの有効期限が切れるまでにこのホストを 1 回登録できます。その後、ホストは独自の接続認証情報を保持します。CLI の管理用認証情報は作成されません。ローカル接続を削除するにはホストを切断するか、Hub で取り消してください。",
    noPermissions: "なし",
    credentialNotice:
      "この認証情報に自動の有効期限はありません。オーナーまたは管理者が Hub → 構成 → API キー で取り消す必要があります。CLI からログアウトしても、ローカルのコピーが削除されるだけです。ホストのオンボーディングには hub connect を使用してください。",
    impacts: {
      listProjects: "プロジェクトを一覧表示し、構成を読み取る",
      installTriggers: "トリガーと構成をインストールする",
      enrollHosts: "ホストを登録する（登録した各ホストはこの組織に参加します）",
      startRuns: "オートメーションの実行を開始する",
    },
  },
  connectionResults: {
    githubApprovalRequired: {
      title: "GitHub オーナーの承認が必要です",
      description:
        "GitHub 組織のオーナーにこのインストールの承認を依頼してから、もう一度接続してください。",
    },
    slackBotFailed: {
      title: "Slack の権限が不足しています",
      description:
        "セットアップガイドのマニフェストを Slack に適用してから、もう一度インストールしてください。Hub はこの接続を保存していません。",
    },
    providerNotConfigured: {
      title: "プロバイダーアプリケーションが必要です",
      description:
        "アカウントを接続する前に、プロバイダーアプリケーションを検証して保存してください。",
    },
    connectionInvalid: {
      title: "接続リンクを利用できません",
      description:
        "このセットアップリンクは有効期限切れか、すでに使用されています。下の「アカウントを接続」からやり直してください。",
    },
    connectionConflict: {
      title: "アカウントは別の場所で接続されています",
      description:
        "プロバイダーのアカウントを別の組織から切断するか、別のアカウントを選択してください。",
    },
    completed: {
      title: "{{provider}} のセットアップが完了しました",
      description:
        "プロバイダーのセットアップから戻りました。下の更新済みリストに現在の接続の状態が表示されます。",
    },
    cancelled: {
      title: "{{provider}} のセットアップをキャンセルしました",
      description: "準備ができたら、もう一度「アカウントを接続」を開始してください。",
    },
  },
  continuation: {
    openFailed:
      "プロバイダーのページを開けませんでした。「セットアップを続行」で再試行してください。",
  },
  sidebar: {
    organization: "Hub の組織: {{name}}",
    personalHub: "パーソナル Hub",
    personalHubSettings: "パーソナル Hub の設定",
    hubAccount: "Hub アカウント",
    accountLabel: "Hub アカウント: {{label}}",
    signIn: "サインイン",
    hubUnavailable: "Hub を利用できません",
    signInToAccount: "アカウントにサインイン",
  },
};

const ko: Translation<HubAccountCopy> = {
  errors: {
    notIncluded: "이 빌드에는 Hub 지원이 포함되어 있지 않습니다.",
    pairFirst: "먼저 Hub를 페어링하세요.",
    requestFailed: "Hub 요청에 실패했습니다.",
    requestFailedStatus: "Hub 요청에 실패했습니다({{status}}).",
    signInFirst: "먼저 Hub에 로그인하세요.",
    unavailable: "Hub를 사용할 수 없습니다.",
    registrationFailed: "Hub 가입 요청에 실패했습니다({{status}}).",
    saveFailed: "Hub에서 변경 사항을 저장하지 못했습니다({{status}}).",
    invalidProfileName: "100자 이하로 이름을 입력하세요.",
    invalidProfileImage:
      "이 Hub가 신뢰하는 호스트의 https 이미지 링크(예: Google 또는 Gravatar 사진)를 사용하세요.",
    invalidOrganizationName: "100자 이하로 조직 이름을 입력하세요.",
    organizationOwnerRequired: "조직 이름은 조직 소유자만 변경할 수 있습니다.",
  },
  googleSignIn: {
    registrationClosed:
      "이 Google 계정은 이 Hub에 참여할 수 없습니다. 초대받은 주소나 허용된 회사 도메인을 사용하세요.",
    emailUnverified: "Google에서 이 이메일 주소를 확인하지 않아 Hub에서 사용할 수 없습니다.",
    linkedToDifferentAccount:
      "이 Google 계정은 다른 Hub 계정에 연결되어 있습니다. Hub 운영자에게 복구를 요청하세요.",
    profileUnavailable:
      "Google이 Hub에 필요한 프로필을 반환하지 않았습니다. Google로 다시 로그인해 보세요.",
    instanceUnavailable: "다른 사람이 이미 이 Hub를 설정했습니다. 대신 내 계정으로 로그인하세요.",
    unableToLink: "Hub는 이 계정에 Google을 자동으로 연결하지 않습니다. 비밀번호로 로그인하세요.",
    accountNotLinked:
      "이 이메일로 된 계정이 있지만 Google에서 주소를 확인하지 못했습니다. 비밀번호로 로그인하세요.",
  },
  signIn: {
    canceled: "Hub 로그인이 취소되었습니다.",
    noRefreshToken: "Hub가 새로 고침 토큰을 발급하지 않았습니다.",
    credentialExchangeFailed: "Hub 자격 증명 교환에 실패했습니다({{status}}).",
    emailAndPasswordRequired: "이메일과 비밀번호가 필요합니다.",
    googleStartFailed: "Hub에서 Google 로그인을 시작하지 못했습니다.",
    signOutFailed: "Hub 로그아웃에 실패했습니다.",
    browserOriginRequired:
      "브라우저에서 Hub에 접근하려면 Clisbot 클라이언트를 Hub 오리진에서 제공해야 합니다.",
    desktopBridgeUnavailable: "데스크톱 Hub 브리지를 사용할 수 없습니다.",
    desktopSignInUnavailable: "데스크톱에서 Hub에 로그인할 수 없습니다.",
    desktopSignOutUnavailable: "데스크톱에서 Hub 로그아웃을 할 수 없습니다.",
    notAdmitted: "이 계정은 이 Hub에 참여할 수 없습니다. 조직 소유자에게 초대를 요청하세요.",
    incorrectCredentials: "이메일 또는 비밀번호가 올바르지 않습니다.",
    stateMismatch: "Hub 로그인 상태가 일치하지 않습니다.",
    unexpectedIssuer: "예상치 못한 Hub 발급자입니다.",
    failed: "Hub 로그인에 실패했습니다: {{error}}",
    noAuthorizationCode: "Hub가 인증 코드를 반환하지 않았습니다.",
  },
  roles: {
    owner: "소유자",
    admin: "관리자",
    member: "멤버",
  },
  welcome: {
    addAnotherHub: "+ 다른 Hub 추가",
    oneHubPerApp: "현재는 앱당 Hub 하나만 사용할 수 있습니다.",
    setUpHub: "Hub 설정",
    description: "로그인하면 조직에서 공유한 호스트와 프로젝트를 사용할 수 있습니다.",
    whatIsHub: "Hub란?",
    signIn: "Hub에 로그인",
    continueWithGoogle: "Google로 계속",
    useEmailAndPassword: "이메일과 비밀번호 사용",
    actions: {
      account: "계정",
      refreshHosts: "호스트 새로 고침",
      retry: "다시 시도",
    },
    badges: {
      actionNeeded: "조치 필요",
      error: "오류",
      loading: "불러오는 중",
      noHost: "호스트 없음",
    },
    steps: {
      organizationRequired: "계속하려면 조직을 선택하세요.",
      appSetupRequired: "계속하려면 이 앱의 설정을 완료하세요.",
      passwordChangeRequired: "계속하려면 비밀번호를 변경하세요.",
      finishSigningIn: "계정을 열어 로그인을 완료하세요.",
    },
    connectFailed: "{{label}}에 연결하지 못했습니다: {{message}}",
    hostsFailed: "Clisbot이 조직에서 공유한 호스트를 불러오지 못했습니다.",
    loadingHosts: "조직에서 공유한 호스트를 불러오는 중…",
    noHostCanAdd:
      "아직 공유받은 호스트가 없습니다. 사용할 컴퓨터에서 `clisbot hub connect`를 실행하거나, 아래에서 내 호스트를 연결하세요.",
    noHostAskAccess:
      "아직 공유받은 호스트가 없습니다. 조직 소유자나 관리자에게 접근 권한을 요청하거나, 아래에서 내 호스트를 연결하세요.",
    hostConnected: "{{label}}이(가) 연결되었습니다.",
    connectingTo: "{{label}}에 연결하는 중…",
    hostHint: "{{label}}: {{hint}}",
    cannotReach: "Clisbot이 {{label}}에 연결할 수 없습니다.",
  },
  hostStatus: {
    online: "온라인",
    onlineDescription: "프로젝트와 에이전트를 사용할 수 있습니다",
    connecting: "연결 중",
    connectingDescription: "Clisbot이 이 호스트에 연결하는 중입니다",
    waiting: "연결 대기 중",
    unavailable: "상태를 알 수 없음",
    offline: "오프라인",
    failed: "연결 실패",
    unreachableDescription:
      "Clisbot이 이 호스트에 연결할 수 없습니다. 다시 연결하거나 해당 컴퓨터의 데몬을 확인하세요:",
    registering: "등록 중",
    registeringDescription: "Clisbot이 이 데몬을 호스트로 추가하는 중입니다",
    offerOffline:
      "이 호스트는 Hub에 연결되어 있지 않습니다. 해당 컴퓨터에서 Clisbot을 시작하고 clisbot hub status를 확인한 다음 호스트를 새로 고치세요.",
    offerConnected:
      "이 호스트는 Hub에 연결되어 있지만 연결 정보를 공유하지 않았습니다. 해당 컴퓨터에서 릴레이가 켜져 있는지 확인한 다음 호스트를 새로 고치세요.",
    offerUnavailable:
      "이 호스트의 연결 상태를 알 수 없습니다. 해당 컴퓨터에서 clisbot hub status를 확인한 다음 호스트를 새로 고치세요.",
  },
  hostRow: {
    hostId: "호스트 ID: {{id}}",
    hubId: "Hub ID: {{id}}",
    copy: "복사",
    disconnect: "연결 해제",
    disconnected: "연결 해제됨",
    actionsFor: "{{label}} 작업",
    retry: "다시 시도",
    addProject: "프로젝트 추가",
    openHost: "호스트 열기",
    reconnect: "다시 연결",
    connections: "연결",
  },
  synchronization: {
    conflictWithHint:
      "저장된 호스트가 이 Hub의 연결 정보와 충돌합니다. 호스트의 연결 설정을 확인하세요.",
    conflict: "저장된 호스트가 이 Hub의 연결 정보와 충돌합니다.",
    addFailed: "이 호스트를 Clisbot에 추가하지 못했습니다.",
    renameFailed: "호스트 이름을 업데이트하지 못했습니다.",
  },
  copyCommand: {
    copy: "명령 복사",
    copied: "복사됨",
    failed: "명령을 복사하지 못했습니다.",
  },
  nextSteps: {
    newBot: "새 봇",
    title: "다음에 무엇을 하시겠어요?",
    hint: "다음 단계를 선택하거나 홈으로 계속하세요.",
    createBot: "봇 만들기",
    createBotDescription: "어시스턴트에게 역할과 전용 작업 공간을 부여합니다.",
    addProject: "프로젝트 추가",
    addProjectDescription: "이 호스트의 폴더에서 문서나 코드로 작업합니다.",
    addHost: "다른 호스트 추가",
    addHostDescription: "Hub를 통해 또는 직접 다른 컴퓨터를 연결합니다.",
    managedHost: "Hub를 통해 관리형 호스트 추가",
    directHost: "직접 호스트 연결",
    continueHome: "홈으로 계속",
  },
  cliLogin: {
    home: "홈",
    settings: "설정",
    connectHost: "호스트 연결",
    advancedAccess: "고급 CLI 접근",
    approveRequest: "터미널 요청 승인",
    verificationCode: "인증 코드",
    verificationHint: "직접 요청한 코드만 승인하세요.",
    continue: "계속",
    connectHostTitle: "호스트 연결",
    hostAdded: "{{label}}이(가) Clisbot에 추가되었습니다",
    hostOnline: "호스트가 온라인입니다. 다음에 할 일을 선택하거나 앱으로 계속하세요.",
    hostConnecting: "호스트가 추가되었으며 Clisbot이 연결하는 중입니다.",
    openHosts: "호스트 열기",
    hostNotDetected: "연결이 승인되었지만 호스트가 감지되지 않았습니다",
    connectionApproved: "호스트 연결이 승인되었습니다",
    hostNotDetectedDescription:
      "호스트를 열어 연결을 확인하세요. 호스트가 없으면 데몬 로그를 확인한 다음 감지를 다시 시도하세요.",
    connectionApprovedDescription:
      "Clisbot이 승인된 호스트를 자동으로 연결하고 있습니다. 터미널 명령이 끝날 때까지 기다리세요. 이 페이지에서 연결 상태를 따라갑니다.",
    retry: "다시 시도",
    waitingForHost: "등록된 호스트를 기다리는 중...",
    checking: "요청을 확인하는 중...",
    requestUnavailable: "요청을 사용할 수 없음",
    requestUnavailableDescription:
      "코드와 Hub 연결을 확인하거나, 요청이 만료되었다면 터미널에서 명령을 다시 실행하세요.",
    enterAnotherCode: "다른 코드 입력",
    decisionFailed: "결정을 기록하지 못했습니다",
    decisionError: "CLI 로그인 결정을 기록하지 못했습니다.",
    deny: "거부",
    approveFor: "{{organization}}에 대해 승인",
    approvalRequired: "소유자 또는 관리자의 승인이 필요합니다",
    approvalRequiredDescription:
      "조직 소유자나 관리자가 이 요청을 승인해야 합니다. 이 조직을 관리할 수 있는 계정으로 로그인하세요.",
    openAccount: "계정 열기",
    denied: "요청이 거부되었습니다",
    deniedDescription: "이 창을 닫고 터미널로 돌아가도 됩니다.",
    loginApproved: "CLI 로그인이 승인되었습니다",
    loginApprovedDescription:
      "터미널로 돌아가세요. 조직 API 접근 권한이 부여되며 호스트는 추가되지 않습니다. 호스트를 추가하려면 hub connect를 사용하세요.",
  },
  cliSummary: {
    connectHostEyebrow: "조직에 호스트 연결",
    advancedAccessEyebrow: "조직의 고급 CLI 접근",
    organizationId: "조직 ID",
    approvedBy: "승인자",
    hub: "Hub",
    code: "코드",
    codeHint: "터미널의 코드와 일치해야 합니다",
    requestExpires: "요청 만료",
    host: "호스트",
    hostId: "호스트 ID",
    hostPublicKey: "호스트 공개 키",
    allowHost: "{{organization}}이(가) 이 호스트를 사용하도록 허용",
    actFor: "이 CLI는 {{organization}}을(를) 대신해 작동합니다",
    hostPermissions:
      "이 호스트에 대한 Hub 권한: {{permissions}}.\n\n승인하면 요청이 만료되기 전에 이 호스트를 한 번 등록할 수 있습니다. 이후 호스트는 자체 연결 자격 증명을 유지합니다. CLI 관리 자격 증명은 생성되지 않습니다. 로컬 연결을 제거하려면 호스트 연결을 해제하거나 Hub에서 취소하세요.",
    noPermissions: "없음",
    credentialNotice:
      "이 자격 증명은 자동으로 만료되지 않습니다. 소유자나 관리자가 Hub → 구성 → API 키에서 취소해야 합니다. CLI에서 로그아웃하면 로컬 사본만 삭제됩니다. 호스트 온보딩에는 hub connect를 사용하세요.",
    impacts: {
      listProjects: "프로젝트 목록 확인 및 구성 읽기",
      installTriggers: "트리거와 구성 설치",
      enrollHosts: "호스트 등록(등록된 각 호스트는 이 조직에 참여)",
      startRuns: "자동화 실행 시작",
    },
  },
  connectionResults: {
    githubApprovalRequired: {
      title: "GitHub 소유자의 승인이 필요합니다",
      description: "GitHub 조직 소유자에게 이 설치를 승인해 달라고 요청한 다음 다시 연결하세요.",
    },
    slackBotFailed: {
      title: "Slack 권한이 부족합니다",
      description:
        "설정 가이드의 매니페스트를 Slack에 적용한 다음 다시 설치하세요. Hub는 이 연결을 저장하지 않았습니다.",
    },
    providerNotConfigured: {
      title: "제공자 애플리케이션이 필요합니다",
      description: "계정을 연결하기 전에 제공자 애플리케이션을 확인하고 저장하세요.",
    },
    connectionInvalid: {
      title: "연결 링크를 사용할 수 없습니다",
      description:
        "이 설정 링크가 만료되었거나 이미 사용되었습니다. 아래에서 계정 연결을 다시 시작하세요.",
    },
    connectionConflict: {
      title: "다른 곳에 연결된 계정",
      description: "제공자 계정을 다른 조직에서 연결 해제하거나 다른 계정을 선택하세요.",
    },
    completed: {
      title: "{{provider}} 설정 완료",
      description:
        "제공자 설정에서 돌아왔습니다. 아래의 새로 고친 목록에 현재 연결 상태가 표시됩니다.",
    },
    cancelled: {
      title: "{{provider}} 설정 취소됨",
      description: "준비가 되면 계정 연결을 다시 시작하세요.",
    },
  },
  continuation: {
    openFailed: "제공자 페이지를 열 수 없습니다. 설정 계속을 사용해 다시 시도하세요.",
  },
  sidebar: {
    organization: "Hub 조직: {{name}}",
    personalHub: "개인 Hub",
    personalHubSettings: "개인 Hub 설정",
    hubAccount: "Hub 계정",
    accountLabel: "Hub 계정: {{label}}",
    signIn: "로그인",
    hubUnavailable: "Hub를 사용할 수 없음",
    signInToAccount: "계정에 로그인",
  },
};

const ptBR: Translation<HubAccountCopy> = {
  errors: {
    notIncluded: "Esta versão não inclui suporte ao Hub.",
    pairFirst: "Primeiro, pareie um Hub.",
    requestFailed: "A solicitação ao Hub falhou.",
    requestFailedStatus: "A solicitação ao Hub falhou ({{status}}).",
    signInFirst: "Primeiro, entre no Hub.",
    unavailable: "O Hub está indisponível.",
    registrationFailed: "A solicitação de cadastro no Hub falhou ({{status}}).",
    saveFailed: "O Hub não conseguiu salvar a alteração ({{status}}).",
    invalidProfileName: "Digite um nome com até 100 caracteres.",
    invalidProfileImage:
      "Use um link de imagem https de um host em que este Hub confia, como uma foto do Google ou do Gravatar.",
    invalidOrganizationName: "Digite um nome de organização com até 100 caracteres.",
    organizationOwnerRequired: "Somente um proprietário da organização pode renomeá-la.",
  },
  googleSignIn: {
    registrationClosed:
      "Esta conta do Google não tem acesso a este Hub. Use um endereço convidado ou um domínio de empresa permitido.",
    emailUnverified: "O Google não verificou este endereço de e-mail, então o Hub não pode usá-lo.",
    linkedToDifferentAccount:
      "Esta conta do Google está vinculada a outra conta do Hub. Peça ao operador do Hub para recuperá-la.",
    profileUnavailable:
      "O Google não retornou o perfil de que o Hub precisa. Tente entrar com o Google novamente.",
    instanceUnavailable: "Outra pessoa já configurou este Hub. Entre com sua conta.",
    unableToLink: "O Hub não vincula o Google a esta conta automaticamente. Entre com sua senha.",
    accountNotLinked:
      "Já existe uma conta com este e-mail, mas o Google não conseguiu comprovar o endereço. Entre com sua senha.",
  },
  signIn: {
    canceled: "O login no Hub foi cancelado.",
    noRefreshToken: "O Hub não emitiu um token de atualização.",
    credentialExchangeFailed: "A troca de credenciais com o Hub falhou ({{status}}).",
    emailAndPasswordRequired: "E-mail e senha são obrigatórios.",
    googleStartFailed: "O Hub não conseguiu iniciar o login com o Google.",
    signOutFailed: "Não foi possível sair do Hub.",
    browserOriginRequired:
      "O acesso ao Hub pelo navegador exige que o cliente Clisbot seja servido a partir da origem do Hub.",
    desktopBridgeUnavailable: "A ponte do Hub para desktop está indisponível.",
    desktopSignInUnavailable: "O login no Hub pelo desktop está indisponível.",
    desktopSignOutUnavailable: "A saída do Hub pelo desktop está indisponível.",
    notAdmitted:
      "Esta conta não tem acesso a este Hub. Peça a um proprietário da organização para convidar você.",
    incorrectCredentials: "O e-mail ou a senha estão incorretos.",
    stateMismatch: "O estado do login no Hub não corresponde.",
    unexpectedIssuer: "Emissor do Hub inesperado.",
    failed: "O login no Hub falhou: {{error}}",
    noAuthorizationCode: "O Hub não retornou um código de autorização.",
  },
  roles: {
    owner: "Proprietário",
    admin: "Administrador",
    member: "Membro",
  },
  welcome: {
    addAnotherHub: "+ Adicionar outro Hub",
    oneHubPerApp: "Por enquanto, um Hub por app.",
    setUpHub: "Configurar Hub",
    description: "Entre para usar os Hosts e Projetos que sua organização compartilha com você.",
    whatIsHub: "O que é um Hub?",
    signIn: "Entrar no Hub",
    continueWithGoogle: "Continuar com o Google",
    useEmailAndPassword: "Usar e-mail e senha",
    actions: {
      account: "Conta",
      refreshHosts: "Atualizar Hosts",
      retry: "Tentar novamente",
    },
    badges: {
      actionNeeded: "Ação necessária",
      error: "Erro",
      loading: "Carregando",
      noHost: "Nenhum Host",
    },
    steps: {
      organizationRequired: "Escolha uma organização para continuar.",
      appSetupRequired: "Conclua a configuração deste app para continuar.",
      passwordChangeRequired: "Altere sua senha para continuar.",
      finishSigningIn: "Abra Conta para concluir o login.",
    },
    connectFailed: "Não foi possível conectar {{label}}: {{message}}",
    hostsFailed: "O Clisbot não conseguiu carregar os Hosts que sua organização compartilha.",
    loadingHosts: "Carregando os Hosts que sua organização compartilha…",
    noHostCanAdd:
      "Nenhum Host foi compartilhado com você ainda. Execute `clisbot hub connect` no computador que você quer usar ou conecte um dos seus abaixo.",
    noHostAskAccess:
      "Nenhum Host foi compartilhado com você ainda. Peça acesso a um proprietário ou administrador da organização ou conecte um dos seus abaixo.",
    hostConnected: "{{label}} está conectado.",
    connectingTo: "Conectando a {{label}}…",
    hostHint: "{{label}}: {{hint}}",
    cannotReach: "O Clisbot não consegue alcançar {{label}}.",
  },
  hostStatus: {
    online: "Online",
    onlineDescription: "Pronto para Projetos e Agentes",
    connecting: "Conectando",
    connectingDescription: "O Clisbot está se conectando a este Host",
    waiting: "Aguardando conexão",
    unavailable: "Status indisponível",
    offline: "Offline",
    failed: "Falha na conexão",
    unreachableDescription:
      "O Clisbot não consegue alcançar este Host. Reconecte ou verifique o daemon nesse computador:",
    registering: "Registrando",
    registeringDescription: "O Clisbot está adicionando este daemon como Host",
    offerOffline:
      "Este Host não está conectado ao Hub. Inicie o Clisbot nesse computador e verifique clisbot hub status; depois, atualize os Hosts.",
    offerConnected:
      "Este Host está conectado ao Hub, mas não compartilhou os detalhes de conexão. Verifique se o relay está ativado nesse computador; depois, atualize os Hosts.",
    offerUnavailable:
      "O status de conexão deste Host está indisponível. Verifique clisbot hub status nesse computador; depois, atualize os Hosts.",
  },
  hostRow: {
    hostId: "ID do Host: {{id}}",
    hubId: "ID no Hub: {{id}}",
    copy: "Copiar",
    disconnect: "Desconectar",
    disconnected: "Desconectado",
    actionsFor: "Ações para {{label}}",
    retry: "Tentar novamente",
    addProject: "Adicionar projeto",
    openHost: "Abrir Host",
    reconnect: "Reconectar",
    connections: "Conexões",
  },
  synchronization: {
    conflictWithHint:
      "Um Host salvo entra em conflito com os detalhes de conexão deste Hub. Verifique as configurações de Conexões do Host.",
    conflict: "Um Host salvo entra em conflito com os detalhes de conexão deste Hub.",
    addFailed: "Não foi possível adicionar este Host ao Clisbot.",
    renameFailed: "Não foi possível atualizar o nome do Host.",
  },
  copyCommand: {
    copy: "Copiar comando",
    copied: "Copiado",
    failed: "Não foi possível copiar o comando.",
  },
  nextSteps: {
    newBot: "Novo bot",
    title: "O que você quer fazer agora?",
    hint: "Escolha um próximo passo ou continue para o Início.",
    createBot: "Criar um Bot",
    createBotDescription: "Dê a um assistente uma função e seu próprio espaço de trabalho.",
    addProject: "Adicionar um Projeto",
    addProjectDescription: "Trabalhe com documentos ou código em uma pasta deste Host.",
    addHost: "Adicionar outro Host",
    addHostDescription: "Conecte outro computador pelo Hub ou diretamente.",
    managedHost: "Adicionar Host gerenciado pelo Hub",
    directHost: "Conectar um Host direto",
    continueHome: "Continuar para o Início",
  },
  cliLogin: {
    home: "Início",
    settings: "Configurações",
    connectHost: "Conectar Host",
    advancedAccess: "Acesso avançado à CLI",
    approveRequest: "Aprovar uma solicitação do terminal",
    verificationCode: "Código de verificação",
    verificationHint: "Só aprove um código que você mesmo solicitou.",
    continue: "Continuar",
    connectHostTitle: "Conectar host",
    hostAdded: "{{label}} foi adicionado ao Clisbot",
    hostOnline: "O Host está online. Escolha o que fazer agora ou continue para o app.",
    hostConnecting: "O Host foi adicionado e o Clisbot está se conectando a ele.",
    openHosts: "Abrir Hosts",
    hostNotDetected: "Conexão aprovada; Host não detectado",
    connectionApproved: "Conexão do Host aprovada",
    hostNotDetectedDescription:
      "Abra Hosts para verificar a conexão. Se ele não aparecer, verifique os logs do daemon e tente a detecção novamente.",
    connectionApprovedDescription:
      "O Clisbot está conectando o Host aprovado automaticamente. Deixe o comando do terminal terminar; esta página acompanha a conexão.",
    retry: "Tentar novamente",
    waitingForHost: "Aguardando o host registrado...",
    checking: "Verificando a solicitação...",
    requestUnavailable: "Solicitação indisponível",
    requestUnavailableDescription:
      "Verifique o código e a conexão com o Hub ou execute o comando novamente no terminal se a solicitação expirou.",
    enterAnotherCode: "Digitar outro código",
    decisionFailed: "Não foi possível registrar a decisão",
    decisionError: "Não foi possível registrar a decisão de login da CLI.",
    deny: "Negar",
    approveFor: "Aprovar para {{organization}}",
    approvalRequired: "Aprovação de proprietário ou administrador necessária",
    approvalRequiredDescription:
      "Um proprietário ou administrador da organização precisa aprovar esta solicitação. Entre com uma conta que possa gerenciar esta organização.",
    openAccount: "Abrir conta",
    denied: "Solicitação negada",
    deniedDescription: "Você pode fechar esta janela e voltar ao terminal.",
    loginApproved: "Login da CLI aprovado",
    loginApprovedDescription:
      "Volte ao terminal. Isso concede acesso à API da organização; não adiciona um Host. Use hub connect para adicionar um Host.",
  },
  cliSummary: {
    connectHostEyebrow: "Conectar Host à organização",
    advancedAccessEyebrow: "Acesso avançado à CLI para a organização",
    organizationId: "ID da organização",
    approvedBy: "Aprovado por",
    hub: "Hub",
    code: "Código",
    codeHint: "Deve corresponder ao código no seu terminal",
    requestExpires: "A solicitação expira",
    host: "Host",
    hostId: "ID do Host",
    hostPublicKey: "Chave pública do Host",
    allowHost: "Permitir que {{organization}} use este Host",
    actFor: "Esta CLI vai agir em nome de {{organization}}",
    hostPermissions:
      "Permissões do Hub neste Host: {{permissions}}.\n\nA aprovação permite um único registro deste Host antes que a solicitação expire. Depois, o Host mantém a própria credencial de conexão. Nenhuma credencial de administração da CLI é criada. Desconecte o Host para remover a conexão local ou revogue-a no Hub.",
    noPermissions: "Nenhuma",
    credentialNotice:
      "A credencial não expira automaticamente. Um proprietário ou administrador precisa revogá-la em Hub → Configuração → Chaves de API. Sair da CLI só remove a cópia local. Use hub connect para integrar Hosts.",
    impacts: {
      listProjects: "Listar Projetos e ler a configuração deles",
      installTriggers: "Instalar gatilhos e configuração",
      enrollHosts: "Registrar Hosts; cada Host registrado entra nesta organização",
      startRuns: "Iniciar execuções de Automações",
    },
  },
  connectionResults: {
    githubApprovalRequired: {
      title: "Aprovação do proprietário do GitHub necessária",
      description:
        "Peça a um proprietário da organização no GitHub para aprovar esta instalação e conecte novamente.",
    },
    slackBotFailed: {
      title: "As permissões do Slack estão incompletas",
      description:
        "Aplique o manifesto do guia de configuração no Slack e instale novamente. O Hub não salvou esta Conexão.",
    },
    providerNotConfigured: {
      title: "Aplicativo do provedor necessário",
      description: "Verifique e salve o aplicativo do provedor antes de conectar uma conta.",
    },
    connectionInvalid: {
      title: "Link de conexão indisponível",
      description:
        "Este link de configuração expirou ou já foi usado. Inicie Conectar conta novamente abaixo.",
    },
    connectionConflict: {
      title: "Conta conectada em outro lugar",
      description:
        "Desconecte a conta do provedor da outra organização ou escolha uma conta diferente.",
    },
    completed: {
      title: "Configuração do {{provider}} concluída",
      description:
        "O provedor voltou da configuração. A lista atualizada abaixo mostra o status atual da Conexão.",
    },
    cancelled: {
      title: "Configuração do {{provider}} cancelada",
      description: "Inicie Conectar conta novamente quando estiver pronto.",
    },
  },
  continuation: {
    openFailed:
      "Não foi possível abrir a página do provedor. Use Continuar configuração para tentar novamente.",
  },
  sidebar: {
    organization: "Organização do Hub: {{name}}",
    personalHub: "Hub pessoal",
    personalHubSettings: "Configurações do Hub pessoal",
    hubAccount: "Conta do Hub",
    accountLabel: "Conta do Hub: {{label}}",
    signIn: "Entrar",
    hubUnavailable: "Hub indisponível",
    signInToAccount: "Entre na sua conta",
  },
};

const ru: Translation<HubAccountCopy> = {
  errors: {
    notIncluded: "Поддержка Hub не включена в эту сборку.",
    pairFirst: "Сначала выполните сопряжение с Hub.",
    requestFailed: "Запрос к Hub не выполнен.",
    requestFailedStatus: "Запрос к Hub не выполнен ({{status}}).",
    signInFirst: "Сначала войдите в Hub.",
    unavailable: "Hub недоступен.",
    registrationFailed: "Запрос на регистрацию в Hub не выполнен ({{status}}).",
    saveFailed: "Hub не удалось сохранить изменение ({{status}}).",
    invalidProfileName: "Введите имя длиной не более 100 символов.",
    invalidProfileImage:
      "Используйте https-ссылку на изображение с хоста, которому доверяет этот Hub, например фото из Google или Gravatar.",
    invalidOrganizationName: "Введите название организации длиной не более 100 символов.",
    organizationOwnerRequired: "Переименовать организацию может только её владелец.",
  },
  googleSignIn: {
    registrationClosed:
      "Этот аккаунт Google не допущен в этот Hub. Используйте адрес из приглашения или разрешённый домен компании.",
    emailUnverified:
      "Google не подтвердил этот адрес электронной почты, поэтому Hub не может его использовать.",
    linkedToDifferentAccount:
      "Этот аккаунт Google привязан к другому аккаунту Hub. Попросите оператора Hub восстановить его.",
    profileUnavailable:
      "Google не вернул профиль, необходимый Hub. Попробуйте снова войти через Google.",
    instanceUnavailable: "Этот Hub уже настроил кто-то другой. Войдите со своим аккаунтом.",
    unableToLink: "Hub не привязывает Google к этому аккаунту автоматически. Войдите с паролем.",
    accountNotLinked:
      "Аккаунт с этим адресом существует, но Google не смог подтвердить адрес. Войдите с паролем.",
  },
  signIn: {
    canceled: "Вход в Hub отменён.",
    noRefreshToken: "Hub не выдал токен обновления.",
    credentialExchangeFailed: "Не удалось обменять учётные данные с Hub ({{status}}).",
    emailAndPasswordRequired: "Требуются адрес электронной почты и пароль.",
    googleStartFailed: "Hub не смог начать вход через Google.",
    signOutFailed: "Не удалось выйти из Hub.",
    browserOriginRequired:
      "Для доступа к Hub из браузера клиент Clisbot должен открываться с источника Hub.",
    desktopBridgeUnavailable: "Мост Hub для настольного приложения недоступен.",
    desktopSignInUnavailable: "Вход в Hub из настольного приложения недоступен.",
    desktopSignOutUnavailable: "Выход из Hub в настольном приложении недоступен.",
    notAdmitted:
      "Этот аккаунт не допущен в этот Hub. Попросите владельца организации пригласить вас.",
    incorrectCredentials: "Неверный адрес электронной почты или пароль.",
    stateMismatch: "Состояние входа в Hub не совпадает.",
    unexpectedIssuer: "Неожиданный издатель Hub.",
    failed: "Не удалось войти в Hub: {{error}}",
    noAuthorizationCode: "Hub не вернул код авторизации.",
  },
  roles: {
    owner: "Владелец",
    admin: "Администратор",
    member: "Участник",
  },
  welcome: {
    addAnotherHub: "+ Добавить ещё один Hub",
    oneHubPerApp: "Пока один Hub на приложение.",
    setUpHub: "Настроить Hub",
    description:
      "Войдите, чтобы использовать хосты и проекты, которыми с вами делится организация.",
    whatIsHub: "Что такое Hub?",
    signIn: "Войти в Hub",
    continueWithGoogle: "Продолжить с Google",
    useEmailAndPassword: "Войти по почте и паролю",
    actions: {
      account: "Аккаунт",
      refreshHosts: "Обновить хосты",
      retry: "Повторить",
    },
    badges: {
      actionNeeded: "Требуется действие",
      error: "Ошибка",
      loading: "Загрузка",
      noHost: "Нет хоста",
    },
    steps: {
      organizationRequired: "Чтобы продолжить, выберите организацию.",
      appSetupRequired: "Чтобы продолжить, завершите настройку этого приложения.",
      passwordChangeRequired: "Чтобы продолжить, смените пароль.",
      finishSigningIn: "Откройте «Аккаунт», чтобы завершить вход.",
    },
    connectFailed: "Не удалось подключить {{label}}: {{message}}",
    hostsFailed: "Clisbot не удалось загрузить хосты, которыми делится ваша организация.",
    loadingHosts: "Загрузка хостов, которыми делится ваша организация…",
    noHostCanAdd:
      "С вами пока не поделились ни одним хостом. Выполните `clisbot hub connect` на нужном компьютере или подключите свой хост ниже.",
    noHostAskAccess:
      "С вами пока не поделились ни одним хостом. Попросите доступ у владельца или администратора организации или подключите свой хост ниже.",
    hostConnected: "{{label}} подключён.",
    connectingTo: "Подключение к {{label}}…",
    hostHint: "{{label}}: {{hint}}",
    cannotReach: "Clisbot не может связаться с {{label}}.",
  },
  hostStatus: {
    online: "Онлайн",
    onlineDescription: "Готов к работе с проектами и агентами",
    connecting: "Подключение",
    connectingDescription: "Clisbot подключается к этому хосту",
    waiting: "Ожидание подключения",
    unavailable: "Статус недоступен",
    offline: "Не в сети",
    failed: "Ошибка подключения",
    unreachableDescription:
      "Clisbot не может связаться с этим хостом. Переподключитесь или проверьте демон на том компьютере:",
    registering: "Регистрация",
    registeringDescription: "Clisbot добавляет этот демон как хост",
    offerOffline:
      "Этот хост не подключён к Hub. Запустите Clisbot на том компьютере и проверьте clisbot hub status, затем обновите хосты.",
    offerConnected:
      "Этот хост подключён к Hub, но не передал данные для подключения. Убедитесь, что на том компьютере включён ретранслятор, затем обновите хосты.",
    offerUnavailable:
      "Статус подключения этого хоста недоступен. Проверьте clisbot hub status на том компьютере, затем обновите хосты.",
  },
  hostRow: {
    hostId: "ID хоста: {{id}}",
    hubId: "ID в Hub: {{id}}",
    copy: "Копировать",
    disconnect: "Отключить",
    disconnected: "Отключён",
    actionsFor: "Действия для {{label}}",
    retry: "Повторить",
    addProject: "Добавить проект",
    openHost: "Открыть хост",
    reconnect: "Переподключить",
    connections: "Подключения",
  },
  synchronization: {
    conflictWithHint:
      "Сохранённый хост конфликтует с данными подключения этого Hub. Проверьте настройки подключений хоста.",
    conflict: "Сохранённый хост конфликтует с данными подключения этого Hub.",
    addFailed: "Не удалось добавить этот хост в Clisbot.",
    renameFailed: "Не удалось обновить имя хоста.",
  },
  copyCommand: {
    copy: "Копировать команду",
    copied: "Скопировано",
    failed: "Не удалось скопировать команду.",
  },
  nextSteps: {
    newBot: "Новый бот",
    title: "Что вы хотите сделать дальше?",
    hint: "Выберите следующий шаг или перейдите на главную.",
    createBot: "Создать бота",
    createBotDescription: "Дайте ассистенту роль и собственное рабочее пространство.",
    addProject: "Добавить проект",
    addProjectDescription: "Работайте с документами или кодом в папке на этом хосте.",
    addHost: "Добавить ещё один хост",
    addHostDescription: "Подключите другой компьютер через Hub или напрямую.",
    managedHost: "Добавить управляемый хост через Hub",
    directHost: "Подключить хост напрямую",
    continueHome: "Перейти на главную",
  },
  cliLogin: {
    home: "Главная",
    settings: "Настройки",
    connectHost: "Подключить хост",
    advancedAccess: "Расширенный доступ CLI",
    approveRequest: "Подтвердить запрос из терминала",
    verificationCode: "Код подтверждения",
    verificationHint: "Подтверждайте только код, который запросили сами.",
    continue: "Продолжить",
    connectHostTitle: "Подключить хост",
    hostAdded: "{{label}} добавлен в Clisbot",
    hostOnline: "Хост в сети. Выберите, что делать дальше, или перейдите в приложение.",
    hostConnecting: "Хост добавлен, Clisbot подключается к нему.",
    openHosts: "Открыть хосты",
    hostNotDetected: "Подключение одобрено; хост не обнаружен",
    connectionApproved: "Подключение хоста одобрено",
    hostNotDetectedDescription:
      "Откройте хосты, чтобы проверить подключение. Если хоста нет, проверьте журналы демона и повторите поиск.",
    connectionApprovedDescription:
      "Clisbot автоматически подключает одобренный хост. Дождитесь завершения команды в терминале; эта страница следит за подключением.",
    retry: "Повторить",
    waitingForHost: "Ожидание зарегистрированного хоста...",
    checking: "Проверка запроса...",
    requestUnavailable: "Запрос недоступен",
    requestUnavailableDescription:
      "Проверьте код и подключение к Hub или снова выполните команду в терминале, если срок действия запроса истёк.",
    enterAnotherCode: "Ввести другой код",
    decisionFailed: "Не удалось записать решение",
    decisionError: "Не удалось записать решение о входе CLI.",
    deny: "Отклонить",
    approveFor: "Одобрить для {{organization}}",
    approvalRequired: "Требуется одобрение владельца или администратора",
    approvalRequiredDescription:
      "Этот запрос должен одобрить владелец или администратор организации. Войдите с аккаунтом, который может управлять этой организацией.",
    openAccount: "Открыть аккаунт",
    denied: "Запрос отклонён",
    deniedDescription: "Можно закрыть это окно и вернуться в терминал.",
    loginApproved: "Вход CLI одобрен",
    loginApprovedDescription:
      "Вернитесь в терминал. Это даёт доступ к API организации, но не добавляет хост. Чтобы добавить хост, используйте hub connect.",
  },
  cliSummary: {
    connectHostEyebrow: "Подключение хоста к организации",
    advancedAccessEyebrow: "Расширенный доступ CLI для организации",
    organizationId: "ID организации",
    approvedBy: "Одобряет",
    hub: "Hub",
    code: "Код",
    codeHint: "Должен совпадать с кодом в вашем терминале",
    requestExpires: "Запрос истекает",
    host: "Хост",
    hostId: "ID хоста",
    hostPublicKey: "Открытый ключ хоста",
    allowHost: "Разрешить {{organization}} использовать этот хост",
    actFor: "Этот CLI будет действовать от имени {{organization}}",
    hostPermissions:
      "Разрешения Hub на этом хосте: {{permissions}}.\n\nОдобрение позволяет зарегистрировать этот хост один раз до истечения срока запроса. После этого хост хранит собственные учётные данные подключения. Учётные данные администрирования CLI не создаются. Отключите хост, чтобы удалить его локальное подключение, или отзовите его в Hub.",
    noPermissions: "Нет",
    credentialNotice:
      "У учётных данных нет автоматического срока действия. Владелец или администратор должен отозвать их в Hub → Конфигурация → API-ключи. Выход из CLI удаляет только локальную копию. Для подключения хостов используйте hub connect.",
    impacts: {
      listProjects: "Просматривать проекты и читать их конфигурацию",
      installTriggers: "Устанавливать триггеры и конфигурацию",
      enrollHosts: "Регистрировать хосты; каждый зарегистрированный хост входит в эту организацию",
      startRuns: "Запускать выполнение автоматизаций",
    },
  },
  connectionResults: {
    githubApprovalRequired: {
      title: "Требуется одобрение владельца GitHub",
      description:
        "Попросите владельца организации GitHub одобрить эту установку, затем подключитесь снова.",
    },
    slackBotFailed: {
      title: "Разрешения Slack неполные",
      description:
        "Примените манифест из руководства по настройке в Slack, затем установите снова. Hub не сохранил это подключение.",
    },
    providerNotConfigured: {
      title: "Требуется приложение провайдера",
      description: "Проверьте и сохраните приложение провайдера, прежде чем подключать аккаунт.",
    },
    connectionInvalid: {
      title: "Ссылка для подключения недоступна",
      description:
        "Срок действия этой ссылки истёк, или она уже использована. Начните «Подключить аккаунт» заново ниже.",
    },
    connectionConflict: {
      title: "Аккаунт подключён в другом месте",
      description:
        "Отключите аккаунт провайдера от другой организации или выберите другой аккаунт.",
    },
    completed: {
      title: "Настройка {{provider}} завершена",
      description:
        "Провайдер вернулся после настройки. Обновлённый список ниже показывает текущий статус подключения.",
    },
    cancelled: {
      title: "Настройка {{provider}} отменена",
      description: "Начните «Подключить аккаунт» снова, когда будете готовы.",
    },
  },
  continuation: {
    openFailed:
      "Не удалось открыть страницу провайдера. Нажмите «Продолжить настройку», чтобы повторить попытку.",
  },
  sidebar: {
    organization: "Организация Hub: {{name}}",
    personalHub: "Личный Hub",
    personalHubSettings: "Настройки личного Hub",
    hubAccount: "Аккаунт Hub",
    accountLabel: "Аккаунт Hub: {{label}}",
    signIn: "Войти",
    hubUnavailable: "Hub недоступен",
    signInToAccount: "Войдите в аккаунт",
  },
};

const vi: Translation<HubAccountCopy> = {
  errors: {
    notIncluded: "Bản build này không hỗ trợ Hub.",
    pairFirst: "Hãy ghép nối một Hub trước.",
    requestFailed: "Yêu cầu tới Hub thất bại.",
    requestFailedStatus: "Yêu cầu tới Hub thất bại ({{status}}).",
    signInFirst: "Hãy đăng nhập vào Hub trước.",
    unavailable: "Hub không khả dụng.",
    registrationFailed: "Yêu cầu đăng ký tới Hub thất bại ({{status}}).",
    saveFailed: "Hub không thể lưu thay đổi ({{status}}).",
    invalidProfileName: "Nhập tên tối đa 100 ký tự.",
    invalidProfileImage:
      "Dùng link ảnh https từ một tên miền mà Hub này tin cậy, chẳng hạn ảnh Google hoặc Gravatar.",
    invalidOrganizationName: "Nhập tên tổ chức tối đa 100 ký tự.",
    organizationOwnerRequired: "Chỉ chủ sở hữu tổ chức mới có thể đổi tên tổ chức.",
  },
  googleSignIn: {
    registrationClosed:
      "Tài khoản Google này chưa được chấp nhận vào Hub này. Hãy dùng địa chỉ đã được mời hoặc tên miền công ty được cho phép.",
    emailUnverified: "Google chưa xác minh địa chỉ email này nên Hub không thể dùng nó.",
    linkedToDifferentAccount:
      "Tài khoản Google này đã liên kết với một tài khoản Hub khác. Hãy nhờ người vận hành Hub khôi phục.",
    profileUnavailable:
      "Google không trả về thông tin hồ sơ mà Hub cần. Hãy thử đăng nhập lại bằng Google.",
    instanceUnavailable:
      "Hub này đã được người khác thiết lập. Hãy đăng nhập bằng tài khoản của bạn.",
    unableToLink:
      "Hub không tự động liên kết Google với tài khoản này. Hãy đăng nhập bằng mật khẩu.",
    accountNotLinked:
      "Đã có tài khoản dùng email này, nhưng Google không xác thực được địa chỉ đó. Hãy đăng nhập bằng mật khẩu.",
  },
  signIn: {
    canceled: "Đã hủy đăng nhập Hub.",
    noRefreshToken: "Hub không cấp refresh token.",
    credentialExchangeFailed: "Trao đổi thông tin xác thực với Hub thất bại ({{status}}).",
    emailAndPasswordRequired: "Cần nhập email và mật khẩu.",
    googleStartFailed: "Hub không thể bắt đầu đăng nhập Google.",
    signOutFailed: "Đăng xuất Hub thất bại.",
    browserOriginRequired:
      "Để truy cập Hub trên trình duyệt, Clisbot client phải được phục vụ từ origin của Hub.",
    desktopBridgeUnavailable: "Bridge Hub trên ứng dụng desktop không khả dụng.",
    desktopSignInUnavailable: "Không thể đăng nhập Hub trên ứng dụng desktop.",
    desktopSignOutUnavailable: "Không thể đăng xuất Hub trên ứng dụng desktop.",
    notAdmitted:
      "Tài khoản này chưa được chấp nhận vào Hub này. Hãy nhờ chủ sở hữu tổ chức mời bạn.",
    incorrectCredentials: "Email hoặc mật khẩu không đúng.",
    stateMismatch: "Trạng thái đăng nhập Hub không khớp.",
    unexpectedIssuer: "Issuer của Hub không như mong đợi.",
    failed: "Đăng nhập Hub thất bại: {{error}}",
    noAuthorizationCode: "Hub không trả về mã ủy quyền.",
  },
  roles: {
    owner: "Chủ sở hữu",
    admin: "Quản trị viên",
    member: "Thành viên",
  },
  welcome: {
    addAnotherHub: "+ Thêm Hub khác",
    oneHubPerApp: "Hiện mỗi ứng dụng chỉ dùng được một Hub.",
    setUpHub: "Thiết lập Hub",
    description: "Đăng nhập để dùng các Host và dự án mà tổ chức chia sẻ với bạn.",
    whatIsHub: "Hub là gì?",
    signIn: "Đăng nhập vào Hub",
    continueWithGoogle: "Tiếp tục với Google",
    useEmailAndPassword: "Dùng email và mật khẩu",
    actions: {
      account: "Tài khoản",
      refreshHosts: "Làm mới Host",
      retry: "Thử lại",
    },
    badges: {
      actionNeeded: "Cần xử lý",
      error: "Lỗi",
      loading: "Đang tải",
      noHost: "Không có Host",
    },
    steps: {
      organizationRequired: "Chọn một tổ chức để tiếp tục.",
      appSetupRequired: "Hoàn tất thiết lập ứng dụng này để tiếp tục.",
      passwordChangeRequired: "Đổi mật khẩu để tiếp tục.",
      finishSigningIn: "Mở Tài khoản để hoàn tất đăng nhập.",
    },
    connectFailed: "Không thể kết nối {{label}}: {{message}}",
    hostsFailed: "Clisbot không thể tải các Host mà tổ chức của bạn chia sẻ.",
    loadingHosts: "Đang tải các Host mà tổ chức của bạn chia sẻ…",
    noHostCanAdd:
      "Chưa có Host nào được chia sẻ với bạn. Hãy chạy `clisbot hub connect` trên máy tính bạn muốn dùng, hoặc kết nối một Host của riêng bạn bên dưới.",
    noHostAskAccess:
      "Chưa có Host nào được chia sẻ với bạn. Hãy xin chủ sở hữu hoặc quản trị viên tổ chức cấp quyền truy cập, hoặc kết nối một Host của riêng bạn bên dưới.",
    hostConnected: "{{label}} đã kết nối.",
    connectingTo: "Đang kết nối tới {{label}}…",
    hostHint: "{{label}}: {{hint}}",
    cannotReach: "Clisbot không thể kết nối tới {{label}}.",
  },
  hostStatus: {
    online: "Trực tuyến",
    onlineDescription: "Sẵn sàng cho dự án và Agent",
    connecting: "Đang kết nối",
    connectingDescription: "Clisbot đang kết nối tới Host này",
    waiting: "Đang chờ kết nối",
    unavailable: "Không rõ trạng thái",
    offline: "Ngoại tuyến",
    failed: "Kết nối thất bại",
    unreachableDescription:
      "Clisbot không thể kết nối tới Host này. Hãy kết nối lại, hoặc kiểm tra daemon trên máy đó:",
    registering: "Đang đăng ký",
    registeringDescription: "Clisbot đang thêm Daemon này làm Host",
    offerOffline:
      "Host này chưa kết nối với Hub. Hãy khởi động Clisbot trên máy đó và kiểm tra clisbot hub status, rồi làm mới danh sách Host.",
    offerConnected:
      "Host này đã kết nối với Hub nhưng chưa chia sẻ thông tin kết nối. Hãy kiểm tra relay đã được bật trên máy đó chưa, rồi làm mới danh sách Host.",
    offerUnavailable:
      "Không rõ trạng thái kết nối của Host này. Hãy kiểm tra clisbot hub status trên máy đó, rồi làm mới danh sách Host.",
  },
  hostRow: {
    hostId: "ID Host: {{id}}",
    hubId: "ID Hub: {{id}}",
    copy: "Sao chép",
    disconnect: "Ngắt kết nối",
    disconnected: "Đã ngắt kết nối",
    actionsFor: "Thao tác cho {{label}}",
    retry: "Thử lại",
    addProject: "Thêm dự án",
    openHost: "Mở Host",
    reconnect: "Kết nối lại",
    connections: "Kết nối",
  },
  synchronization: {
    conflictWithHint:
      "Một Host đã lưu xung đột với thông tin kết nối của Hub này. Hãy kiểm tra phần Kết nối trong cài đặt của Host.",
    conflict: "Một Host đã lưu xung đột với thông tin kết nối của Hub này.",
    addFailed: "Không thể thêm Host này vào Clisbot.",
    renameFailed: "Không thể cập nhật tên Host.",
  },
  copyCommand: {
    copy: "Sao chép lệnh",
    copied: "Đã sao chép",
    failed: "Không thể sao chép lệnh.",
  },
  nextSteps: {
    newBot: "Bot mới",
    title: "Bạn muốn làm gì tiếp theo?",
    hint: "Chọn bước tiếp theo, hoặc tiếp tục về Trang chủ.",
    createBot: "Tạo Bot",
    createBotDescription: "Giao cho trợ lý một vai trò và workspace riêng.",
    addProject: "Thêm dự án",
    addProjectDescription: "Làm việc với tài liệu hoặc code trong một thư mục trên Host này.",
    addHost: "Thêm Host khác",
    addHostDescription: "Kết nối một máy tính khác qua Hub hoặc kết nối trực tiếp.",
    managedHost: "Thêm Host được quản lý qua Hub",
    directHost: "Kết nối Host trực tiếp",
    continueHome: "Tiếp tục về Trang chủ",
  },
  cliLogin: {
    home: "Trang chủ",
    settings: "Cài đặt",
    connectHost: "Kết nối Host",
    advancedAccess: "Quyền truy cập CLI nâng cao",
    approveRequest: "Phê duyệt yêu cầu từ terminal",
    verificationCode: "Mã xác minh",
    verificationHint: "Chỉ phê duyệt mã do chính bạn yêu cầu.",
    continue: "Tiếp tục",
    connectHostTitle: "Kết nối host",
    hostAdded: "Đã thêm {{label}} vào Clisbot",
    hostOnline: "Host đang trực tuyến. Chọn việc tiếp theo, hoặc tiếp tục vào ứng dụng.",
    hostConnecting: "Đã thêm Host và Clisbot đang kết nối tới Host.",
    openHosts: "Mở danh sách Host",
    hostNotDetected: "Đã phê duyệt kết nối; chưa phát hiện Host",
    connectionApproved: "Đã phê duyệt kết nối Host",
    hostNotDetectedDescription:
      "Mở danh sách Host để kiểm tra kết nối. Nếu không thấy Host, hãy kiểm tra log của daemon rồi dò tìm lại.",
    connectionApprovedDescription:
      "Clisbot đang tự động kết nối Host đã được phê duyệt. Hãy để lệnh trong terminal chạy xong; trang này sẽ theo dõi kết nối.",
    retry: "Thử lại",
    waitingForHost: "Đang chờ host đã đăng ký...",
    checking: "Đang kiểm tra yêu cầu...",
    requestUnavailable: "Yêu cầu không khả dụng",
    requestUnavailableDescription:
      "Hãy kiểm tra mã và kết nối Hub, hoặc chạy lại lệnh trong terminal nếu yêu cầu đã hết hạn.",
    enterAnotherCode: "Nhập mã khác",
    decisionFailed: "Không thể ghi nhận quyết định",
    decisionError: "Không thể ghi nhận quyết định đăng nhập CLI.",
    deny: "Từ chối",
    approveFor: "Phê duyệt cho {{organization}}",
    approvalRequired: "Cần chủ sở hữu hoặc quản trị viên phê duyệt",
    approvalRequiredDescription:
      "Chủ sở hữu hoặc quản trị viên của tổ chức phải phê duyệt yêu cầu này. Hãy đăng nhập bằng tài khoản có quyền quản lý tổ chức này.",
    openAccount: "Mở tài khoản",
    denied: "Đã từ chối yêu cầu",
    deniedDescription: "Bạn có thể đóng cửa sổ này và quay lại terminal.",
    loginApproved: "Đã phê duyệt đăng nhập CLI",
    loginApprovedDescription:
      "Hãy quay lại terminal. Thao tác này cấp quyền truy cập API của tổ chức; nó không thêm Host. Dùng hub connect để thêm Host.",
  },
  cliSummary: {
    connectHostEyebrow: "Kết nối Host với tổ chức",
    advancedAccessEyebrow: "Quyền truy cập CLI nâng cao cho tổ chức",
    organizationId: "ID tổ chức",
    approvedBy: "Người phê duyệt",
    hub: "Hub",
    code: "Mã",
    codeHint: "Phải khớp với mã trong terminal của bạn",
    requestExpires: "Yêu cầu hết hạn",
    host: "Host",
    hostId: "ID Host",
    hostPublicKey: "Khóa công khai của Host",
    allowHost: "Cho phép {{organization}} dùng Host này",
    actFor: "CLI này sẽ hoạt động thay mặt {{organization}}",
    hostPermissions:
      "Quyền của Hub trên Host này: {{permissions}}.\n\nPhê duyệt cho phép đăng ký Host này một lần trước khi yêu cầu hết hạn. Sau đó Host giữ thông tin xác thực kết nối riêng của nó. Không có thông tin xác thực quản trị CLI nào được tạo. Ngắt kết nối Host để xóa kết nối cục bộ, hoặc thu hồi trong Hub.",
    noPermissions: "Không có",
    credentialNotice:
      "Thông tin xác thực này không tự hết hạn. Chủ sở hữu hoặc quản trị viên phải thu hồi trong Hub → Cấu hình → API key. Đăng xuất CLI chỉ xóa bản sao cục bộ. Dùng hub connect để thêm Host.",
    impacts: {
      listProjects: "Liệt kê dự án và đọc cấu hình của chúng",
      installTriggers: "Cài đặt trigger và cấu hình",
      enrollHosts: "Đăng ký Host; mỗi Host đã đăng ký sẽ tham gia tổ chức này",
      startRuns: "Bắt đầu lượt chạy tự động hóa",
    },
  },
  connectionResults: {
    githubApprovalRequired: {
      title: "Cần chủ sở hữu GitHub phê duyệt",
      description: "Hãy nhờ chủ sở hữu tổ chức GitHub phê duyệt bản cài đặt này, rồi kết nối lại.",
    },
    slackBotFailed: {
      title: "Quyền Slack chưa đầy đủ",
      description:
        "Áp dụng manifest trong hướng dẫn thiết lập vào Slack, rồi cài đặt lại. Hub chưa lưu kết nối này.",
    },
    providerNotConfigured: {
      title: "Cần ứng dụng provider",
      description: "Hãy xác minh và lưu ứng dụng provider trước khi kết nối tài khoản.",
    },
    connectionInvalid: {
      title: "Link kết nối không khả dụng",
      description:
        "Link thiết lập này đã hết hạn hoặc đã được dùng. Hãy bấm Kết nối tài khoản lại ở bên dưới.",
    },
    connectionConflict: {
      title: "Tài khoản đã được kết nối ở nơi khác",
      description:
        "Hãy ngắt kết nối tài khoản provider khỏi tổ chức kia, hoặc chọn tài khoản khác.",
    },
    completed: {
      title: "Đã hoàn tất thiết lập {{provider}}",
      description:
        "Provider đã trả về sau khi thiết lập. Danh sách bên dưới đã được làm mới và hiển thị trạng thái kết nối hiện tại.",
    },
    cancelled: {
      title: "Đã hủy thiết lập {{provider}}",
      description: "Hãy bấm Kết nối tài khoản lại khi bạn sẵn sàng.",
    },
  },
  continuation: {
    openFailed: "Không thể mở trang của provider. Hãy dùng Tiếp tục thiết lập để thử lại.",
  },
  sidebar: {
    organization: "Tổ chức Hub: {{name}}",
    personalHub: "Hub cá nhân",
    personalHubSettings: "Cài đặt Hub cá nhân",
    hubAccount: "Tài khoản Hub",
    accountLabel: "Tài khoản Hub: {{label}}",
    signIn: "Đăng nhập",
    hubUnavailable: "Không truy cập được Hub",
    signInToAccount: "Đăng nhập vào tài khoản của bạn",
  },
};

const zhCN: Translation<HubAccountCopy> = {
  errors: {
    notIncluded: "此版本未包含 Hub 支持。",
    pairFirst: "请先配对一个 Hub。",
    requestFailed: "Hub 请求失败。",
    requestFailedStatus: "Hub 请求失败（{{status}}）。",
    signInFirst: "请先登录 Hub。",
    unavailable: "Hub 不可用。",
    registrationFailed: "Hub 注册请求失败（{{status}}）。",
    saveFailed: "Hub 无法保存更改（{{status}}）。",
    invalidProfileName: "请输入不超过 100 个字符的名称。",
    invalidProfileImage:
      "请使用此 Hub 信任的主机上的 https 图片链接，例如 Google 或 Gravatar 头像。",
    invalidOrganizationName: "请输入不超过 100 个字符的组织名称。",
    organizationOwnerRequired: "只有组织所有者才能重命名组织。",
  },
  googleSignIn: {
    registrationClosed: "此 Google 账号未获准进入此 Hub。请使用受邀地址或允许的公司域名。",
    emailUnverified: "Google 尚未验证此邮箱地址，因此 Hub 无法使用它。",
    linkedToDifferentAccount: "此 Google 账号已关联到另一个 Hub 账号。请让 Hub 管理者帮你恢复。",
    profileUnavailable: "Google 没有返回 Hub 所需的个人资料。请再次使用 Google 登录。",
    instanceUnavailable: "此 Hub 已由其他人完成设置。请改用你的账号登录。",
    unableToLink: "Hub 不会自动将 Google 关联到此账号。请使用密码登录。",
    accountNotLinked: "已有使用此邮箱的账号，但 Google 无法证明该地址。请使用密码登录。",
  },
  signIn: {
    canceled: "已取消登录 Hub。",
    noRefreshToken: "Hub 没有签发刷新令牌。",
    credentialExchangeFailed: "Hub 凭据交换失败（{{status}}）。",
    emailAndPasswordRequired: "需要填写邮箱和密码。",
    googleStartFailed: "Hub 无法开始 Google 登录。",
    signOutFailed: "退出 Hub 失败。",
    browserOriginRequired: "在浏览器中访问 Hub 时，Clisbot 客户端必须由 Hub 源提供。",
    desktopBridgeUnavailable: "桌面端 Hub 桥接不可用。",
    desktopSignInUnavailable: "桌面端无法登录 Hub。",
    desktopSignOutUnavailable: "桌面端无法退出 Hub。",
    notAdmitted: "此账号未获准进入此 Hub。请让组织所有者邀请你。",
    incorrectCredentials: "邮箱或密码不正确。",
    stateMismatch: "Hub 登录状态不匹配。",
    unexpectedIssuer: "意外的 Hub 签发方。",
    failed: "登录 Hub 失败：{{error}}",
    noAuthorizationCode: "Hub 没有返回授权码。",
  },
  roles: {
    owner: "所有者",
    admin: "管理员",
    member: "成员",
  },
  welcome: {
    addAnotherHub: "+ 添加另一个 Hub",
    oneHubPerApp: "目前每个应用仅支持一个 Hub。",
    setUpHub: "设置 Hub",
    description: "登录后即可使用组织与你共享的主机和项目。",
    whatIsHub: "什么是 Hub？",
    signIn: "登录 Hub",
    continueWithGoogle: "使用 Google 继续",
    useEmailAndPassword: "改用邮箱和密码",
    actions: {
      account: "账号",
      refreshHosts: "刷新主机",
      retry: "重试",
    },
    badges: {
      actionNeeded: "需要操作",
      error: "错误",
      loading: "加载中",
      noHost: "无主机",
    },
    steps: {
      organizationRequired: "请选择一个组织以继续。",
      appSetupRequired: "请完成此应用的设置以继续。",
      passwordChangeRequired: "请修改密码以继续。",
      finishSigningIn: "打开账号以完成登录。",
    },
    connectFailed: "无法连接 {{label}}：{{message}}",
    hostsFailed: "Clisbot 无法加载组织共享的主机。",
    loadingHosts: "正在加载组织共享的主机…",
    noHostCanAdd:
      "还没有与你共享的主机。在要使用的电脑上运行 `clisbot hub connect`，或在下方连接你自己的主机。",
    noHostAskAccess:
      "还没有与你共享的主机。请向组织所有者或管理员申请访问权限，或在下方连接你自己的主机。",
    hostConnected: "{{label}} 已连接。",
    connectingTo: "正在连接到 {{label}}…",
    hostHint: "{{label}}：{{hint}}",
    cannotReach: "Clisbot 无法访问 {{label}}。",
  },
  hostStatus: {
    online: "在线",
    onlineDescription: "可用于项目和 Agent",
    connecting: "连接中",
    connectingDescription: "Clisbot 正在连接此主机",
    waiting: "等待连接",
    unavailable: "状态不可用",
    offline: "离线",
    failed: "连接失败",
    unreachableDescription: "Clisbot 无法访问此主机。请重新连接，或检查该电脑上的 daemon：",
    registering: "注册中",
    registeringDescription: "Clisbot 正在将此 daemon 添加为主机",
    offerOffline:
      "此主机未连接到 Hub。请在该电脑上启动 Clisbot 并检查 clisbot hub status，然后刷新主机。",
    offerConnected:
      "此主机已连接到 Hub，但尚未共享连接信息。请确认该电脑已启用 relay，然后刷新主机。",
    offerUnavailable: "此主机的连接状态不可用。请在该电脑上检查 clisbot hub status，然后刷新主机。",
  },
  hostRow: {
    hostId: "主机 ID：{{id}}",
    hubId: "Hub ID：{{id}}",
    copy: "复制",
    disconnect: "断开连接",
    disconnected: "已断开",
    actionsFor: "{{label}} 的操作",
    retry: "重试",
    addProject: "添加项目",
    openHost: "打开主机",
    reconnect: "重新连接",
    connections: "连接",
  },
  synchronization: {
    conflictWithHint: "已保存的主机与此 Hub 的连接信息冲突。请检查该主机的连接设置。",
    conflict: "已保存的主机与此 Hub 的连接信息冲突。",
    addFailed: "无法将此主机添加到 Clisbot。",
    renameFailed: "无法更新主机名称。",
  },
  copyCommand: {
    copy: "复制命令",
    copied: "已复制",
    failed: "无法复制命令。",
  },
  nextSteps: {
    newBot: "新建 Bot",
    title: "接下来想做什么？",
    hint: "选择下一步，或继续前往首页。",
    createBot: "创建 Bot",
    createBotDescription: "为助手分配角色和专属工作区。",
    addProject: "添加项目",
    addProjectDescription: "处理此主机上某个文件夹中的文档或代码。",
    addHost: "添加另一台主机",
    addHostDescription: "通过 Hub 或直接连接另一台电脑。",
    managedHost: "通过 Hub 添加托管主机",
    directHost: "连接直连主机",
    continueHome: "继续前往首页",
  },
  cliLogin: {
    home: "首页",
    settings: "设置",
    connectHost: "连接主机",
    advancedAccess: "高级 CLI 访问",
    approveRequest: "批准终端请求",
    verificationCode: "验证码",
    verificationHint: "只批准你自己请求的验证码。",
    continue: "继续",
    connectHostTitle: "连接主机",
    hostAdded: "{{label}} 已添加到 Clisbot",
    hostOnline: "主机已在线。选择下一步要做的事，或继续前往应用。",
    hostConnecting: "主机已添加，Clisbot 正在连接它。",
    openHosts: "打开主机",
    hostNotDetected: "连接已批准；未检测到主机",
    connectionApproved: "主机连接已批准",
    hostNotDetectedDescription:
      "打开主机以检查连接。如果主机不在列表中，请检查 daemon 日志，然后重试检测。",
    connectionApprovedDescription:
      "Clisbot 正在自动连接已批准的主机。请等待终端命令完成；此页面会跟进连接进度。",
    retry: "重试",
    waitingForHost: "正在等待已注册的主机...",
    checking: "正在检查请求...",
    requestUnavailable: "请求不可用",
    requestUnavailableDescription:
      "请检查验证码和 Hub 连接；如果请求已过期，请在终端中重新运行命令。",
    enterAnotherCode: "输入其他验证码",
    decisionFailed: "无法记录决定",
    decisionError: "无法记录 CLI 登录决定。",
    deny: "拒绝",
    approveFor: "为 {{organization}} 批准",
    approvalRequired: "需要所有者或管理员批准",
    approvalRequiredDescription:
      "此请求必须由组织所有者或管理员批准。请使用可以管理此组织的账号登录。",
    openAccount: "打开账号",
    denied: "请求已拒绝",
    deniedDescription: "你可以关闭此窗口并返回终端。",
    loginApproved: "CLI 登录已批准",
    loginApprovedDescription:
      "请返回终端。这会授予组织 API 访问权限，但不会添加主机。要添加主机，请使用 hub connect。",
  },
  cliSummary: {
    connectHostEyebrow: "将主机连接到组织",
    advancedAccessEyebrow: "组织的高级 CLI 访问",
    organizationId: "组织 ID",
    approvedBy: "批准人",
    hub: "Hub",
    code: "验证码",
    codeHint: "必须与终端中的验证码一致",
    requestExpires: "请求到期时间",
    host: "主机",
    hostId: "主机 ID",
    hostPublicKey: "主机公钥",
    allowHost: "允许 {{organization}} 使用此主机",
    actFor: "此 CLI 将代表 {{organization}} 操作",
    hostPermissions:
      "Hub 在此主机上的权限：{{permissions}}。\n\n批准后，可在请求到期前注册此主机一次。之后主机会保留自己的连接凭据。不会创建 CLI 管理凭据。断开主机可移除其本地连接，也可以在 Hub 中撤销。",
    noPermissions: "无",
    credentialNotice:
      "此凭据不会自动过期。所有者或管理员必须在 Hub → 配置 → API 密钥 中撤销它。CLI 退出登录只会删除本地副本。添加主机请使用 hub connect。",
    impacts: {
      listProjects: "列出项目并读取其配置",
      installTriggers: "安装触发器和配置",
      enrollHosts: "注册主机；每台注册的主机都会加入此组织",
      startRuns: "启动自动化运行",
    },
  },
  connectionResults: {
    githubApprovalRequired: {
      title: "需要 GitHub 所有者批准",
      description: "请让 GitHub 组织所有者批准此安装，然后重新连接。",
    },
    slackBotFailed: {
      title: "Slack 权限不完整",
      description: "请在 Slack 中应用设置指南里的清单，然后重新安装。Hub 未保存此连接。",
    },
    providerNotConfigured: {
      title: "需要提供方应用",
      description: "连接账号前，请先验证并保存提供方应用。",
    },
    connectionInvalid: {
      title: "连接链接不可用",
      description: "此设置链接已过期或已被使用。请在下方重新开始连接账号。",
    },
    connectionConflict: {
      title: "账号已在其他地方连接",
      description: "请将提供方账号从其他组织断开，或选择其他账号。",
    },
    completed: {
      title: "{{provider}} 设置已完成",
      description: "提供方已完成设置并返回。下方刷新后的列表显示当前的连接状态。",
    },
    cancelled: {
      title: "{{provider}} 设置已取消",
      description: "准备好后，请重新开始连接账号。",
    },
  },
  continuation: {
    openFailed: "无法打开提供方页面。请使用继续设置重试。",
  },
  sidebar: {
    organization: "Hub 组织：{{name}}",
    personalHub: "个人 Hub",
    personalHubSettings: "个人 Hub 设置",
    hubAccount: "Hub 账号",
    accountLabel: "Hub 账号：{{label}}",
    signIn: "登录",
    hubUnavailable: "Hub 不可用",
    signInToAccount: "登录你的账号",
  },
};

export const hubAccount = {
  en,
  ar,
  es,
  fr,
  ja,
  ko,
  "pt-BR": ptBR,
  ru,
  vi,
  "zh-CN": zhCN,
};
