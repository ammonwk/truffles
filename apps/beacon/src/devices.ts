interface Device {
  name: string;
  role: 'judge' | 'attendee';
}

// Combined device map from both networks (10.10.x.x ethernet + 192.168.x.x wifi).
// First names only — duplicates are fine, the welcome page just says "Hey there, Jacob".
// Scanned 2025-02-07. IPs may shift if DHCP reassigns; re-scan before demo.

export const devices: Record<string, Device> = {
  // ============================================================
  // Network 1: 192.168.210.0/23 (Wi-Fi)
  // ============================================================

  // --- Judges ---
  '192.168.210.25': { name: 'Zachary', role: 'judge' },       // Zachary Scott Allen
  '192.168.210.117': { name: 'Cambree', role: 'judge' },      // Cambree Bernkopf
  '192.168.211.134': { name: 'Pearl', role: 'judge' },        // Pearl Hulbert
  '192.168.211.30': { name: 'Jacob', role: 'judge' },         // Could be Jacob Wright (judge), Nef, or Thomas

  // --- Attendees ---
  '192.168.210.4': { name: 'Jordon', role: 'attendee' },      // Jordon Peterson
  '192.168.210.12': { name: 'Hayden', role: 'attendee' },     // Hayden Enloe or Peterson
  '192.168.210.22': { name: 'Cheyne', role: 'attendee' },     // Not in attendee list but on network
  '192.168.210.75': { name: 'Anurup', role: 'attendee' },     // Anurup Kumar
  '192.168.210.93': { name: 'Brett', role: 'attendee' },      // Brett Evanson or Beatty
  '192.168.210.150': { name: 'David', role: 'attendee' },     // Multiple Davids
  '192.168.210.162': { name: 'Garrett', role: 'attendee' },   // Garrett Ermer
  '192.168.210.164': { name: 'Peter', role: 'attendee' },     // Peter Hartvigsen
  '192.168.210.166': { name: 'Doyoung', role: 'attendee' },   // Doyoung Yoon
  '192.168.210.170': { name: 'James', role: 'attendee' },     // James Mainord
  '192.168.210.193': { name: 'Josh', role: 'attendee' },      // Josh (multiple possible)
  '192.168.210.211': { name: 'Joao', role: 'attendee' },      // Joao Sena
  '192.168.210.222': { name: 'Kade', role: 'attendee' },      // Kade Angell
  '192.168.210.239': { name: 'Kevin', role: 'attendee' },     // Kevin Guaman or Eappen
  '192.168.210.247': { name: 'David', role: 'attendee' },     // Multiple Davids
  '192.168.211.13': { name: 'Daniel', role: 'attendee' },     // Daniel Graviet
  '192.168.211.29': { name: 'Calahan', role: 'attendee' },    // Calahan Larson
  '192.168.211.40': { name: 'Trevor', role: 'attendee' },     // Trevor Austin
  '192.168.211.51': { name: 'Tyler', role: 'attendee' },      // Tyler Cook or Jenkins
  '192.168.211.56': { name: 'Minh', role: 'attendee' },       // Minh Le
  '192.168.211.57': { name: 'Luke', role: 'attendee' },       // Luke Skinner or Woods
  '192.168.211.72': { name: 'Austin', role: 'attendee' },     // Austin Wright or Young
  '192.168.211.90': { name: 'Chandler', role: 'attendee' },   // Chandler Ward
  '192.168.211.98': { name: 'Granite', role: 'attendee' },    // Not in attendee list
  '192.168.211.132': { name: 'Meghna', role: 'attendee' },    // Meghna Manjunatha
  '192.168.211.186': { name: 'Isaac', role: 'attendee' },     // Isaac Tai
  '192.168.211.201': { name: 'Vision', role: 'attendee' },    // Not in attendee list
  '192.168.211.210': { name: 'Tanner', role: 'attendee' },    // Tanner Crookston or Higley
  '192.168.211.234': { name: 'Kunj', role: 'attendee' },      // Kunj Rathod
  '192.168.211.238': { name: 'Dakota', role: 'attendee' },    // Not in attendee list

  // ============================================================
  // Network 2: 10.10.128.0/21 (Ethernet)
  // ============================================================

  // --- Judges ---
  '10.10.128.216': { name: 'Dennis', role: 'judge' },         // Dennis Beatty

  // --- Attendees ---
  '10.10.128.194': { name: 'Thomas', role: 'attendee' },      // Thomas Chappell
  '10.10.128.195': { name: 'Sam', role: 'attendee' },         // Sam (multiple possible)
  '10.10.128.198': { name: 'Jacob', role: 'attendee' },       // Jacob (multiple possible)
  '10.10.128.199': { name: 'Tweag', role: 'attendee' },       // Tweag's Mac
  '10.10.128.202': { name: 'Michael', role: 'attendee' },     // Michael Van Slyke or Whitfield
  '10.10.128.209': { name: 'Jason', role: 'attendee' },       // Jason Stewart
  '10.10.128.214': { name: 'Josh', role: 'attendee' },        // Josh (multiple possible)
  '10.10.128.218': { name: 'Kevin', role: 'attendee' },       // Kevin Guaman or Eappen
  '10.10.128.222': { name: 'gsdr', role: 'attendee' },        // Unknown alias
  '10.10.128.223': { name: 'Jacob', role: 'attendee' },       // Jacob (multiple possible)
  '10.10.128.228': { name: 'Jeremiah', role: 'attendee' },    // Jeremiah Smith
  '10.10.128.229': { name: 'Luke', role: 'attendee' },        // Luke Skinner or Woods
  '10.10.128.234': { name: 'Jeremy', role: 'attendee' },      // Jeremy Mumford (jmumford-PAT)
  '10.10.128.240': { name: 'Huey', role: 'attendee' },        // Huey Kolowich
  '10.10.128.225': { name: 'Jake', role: 'attendee' },        // Jacob Nef (jakenef-callandor)
  '10.10.129.201': { name: 'Seth', role: 'attendee' },        // setter1's Mac mini — Seth Jenks
  '10.10.131.48': { name: 'Jason', role: 'attendee' },        // Jason Stewart
  '10.10.131.87': { name: 'Sterling', role: 'attendee' },     // Sterling's MacBook Pro
  '10.10.133.224': { name: 'Redo', role: 'attendee' },        // Redo MacBook Pro
  '10.10.134.131': { name: 'Jake', role: 'attendee' },        // Jacob Nef (jakenef-callandor)
  '10.10.135.226': { name: 'Daniel', role: 'attendee' },      // Daniel Graviet
};
