export interface AppSettings {
  id: string
  restaurantNameAr: string
  currencySymbol: string
  phoneNumber?: string
  receiptFooterAr?: string
  primaryColor?: string
  pinEnabled: boolean
  autoLockMinutes: number   // 0 = never auto-lock
  nextOrderNumber: number
  /** VAT/tax percentage — 0 means no tax. e.g. 14 = 14% */
  taxRate?: number
  /** Service percentage — 0 means disabled. */
  serviceRate?: number
  /** Default delivery fee added to delivery orders */
  defaultDeliveryFee?: number
  /** Enforce employee work schedules for cashier login and POS activity. */
  shiftManagementEnabled?: boolean
  /** Collect employee activity and expose performance/accuracy reports. */
  employeePerformanceTrackingEnabled?: boolean
  /** Earliest timestamp included in performance collection after enabling. */
  employeePerformanceTrackingStartedAt?: number
  /**
   * Maximum discount % a cashier can apply without manager override.
   * undefined or 100 means no limit.
   * REQ-6: Discount limits per role.
   */
  maxCashierDiscountPct?: number
  /** User-configurable keyboard shortcuts: action id → chord string e.g. "ctrl+tab" */
  keyboardShortcuts?: Record<string, string>
  /** Local network mode. Standalone keeps the current single-device behavior. */
  networkMode?: 'standalone' | 'master' | 'side'
  /** LAN port used by the master HTTP API. */
  masterServerPort?: number
  /** Side terminals do not write locally; disconnected writes are blocked. */
  sideDisconnectPolicy?: 'block_actions'
  /** Where receipts should print when side terminals submit orders. */
  receiptPrintRoute?: 'side' | 'master'
  /** POS receipt section order. Missing sections are appended automatically. */
  receiptSectionOrder?: ReceiptSectionId[]
  /** POS receipt sections hidden by manager. */
  receiptHiddenSections?: ReceiptSectionId[]
  /** Show item notes under item rows on POS receipts. */
  receiptShowItemNotes?: boolean
  /** Use tighter spacing and smaller rows for narrow thermal paper. */
  receiptCompactMode?: boolean
  /** Show restaurant logo/image on POS receipt. */
  receiptLogoEnabled?: boolean
  /** Original restaurant logo/image as a data URL. */
  receiptLogoDataUrl?: string
  /** Processed black/white logo as it will be sent to print. */
  receiptLogoProcessedDataUrl?: string
  /** ESC/POS-friendly processed text art derived from the logo. */
  receiptLogoAscii?: string
  /** How logo/images are rendered for receipt preview and print. */
  receiptLogoMode?: 'image' | 'mono' | 'ascii'
  /** Black/white conversion threshold used for logo processing. */
  receiptLogoThreshold?: number
  /** Character width used for ASCII/logo processing. */
  receiptLogoWidth?: number
  /** Invert the processed logo output. */
  receiptLogoInvert?: boolean
  /** Logo block alignment on the printed receipt. */
  receiptLogoAlign?: 'left' | 'center' | 'right'
  /** Maximum logo block width as a percentage of the printable receipt body. */
  receiptLogoMaxWidthPercent?: number
  /** Directory used for automatic and quick backups. */
  backupDirectory?: string
  /** Additional backup directories (up to 2 extra). Written to alongside backupDirectory. */
  backupDirectories?: string[]
  /** Enables scheduled automatic backups while the app is running. */
  autoBackupEnabled?: boolean
  /** Scheduled backup cadence in days. */
  autoBackupIntervalDays?: 1 | 2 | 3 | 4 | 5 | 6 | 7
  /** Run an extra backup when the app closes. */
  autoBackupOnClose?: boolean
  /** Delete automatic backups older than this many days (0 = never delete). */
  backupRetentionDays?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 14 | 30 | 60 | 90
  /** Timestamp of the last successful automatic backup. */
  lastAutoBackupAt?: number
  updatedAt: number
}

export type ReceiptSectionId =
  | 'logo'
  | 'restaurant'
  | 'orderMeta'
  | 'customer'
  | 'items'
  | 'totals'
  | 'payment'
  | 'footer'
