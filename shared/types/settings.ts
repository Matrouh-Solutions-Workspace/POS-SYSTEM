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
  /** Default delivery fee added to delivery orders */
  defaultDeliveryFee?: number
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
