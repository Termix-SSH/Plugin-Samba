// Shell pieces shared by the scripts. They are sent over stdin to bash -s.
// Keep bash parameter expansions out of these strings: they sit inside
// template literals.

/** Finds how Samba is run: INIT, SVC (main unit) and UNITS (all of them). */
export const DETECT = `
INIT=none; SVC=; UNITS=
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  INIT=systemd
  if systemctl list-unit-files smbd.service 2>/dev/null | grep -q '^smbd.service'; then
    SVC=smbd; UNITS=smbd
    systemctl list-unit-files nmbd.service 2>/dev/null | grep -q '^nmbd.service' && UNITS="smbd nmbd"
  elif systemctl list-unit-files smb.service 2>/dev/null | grep -q '^smb.service'; then
    SVC=smb; UNITS=smb
    systemctl list-unit-files nmb.service 2>/dev/null | grep -q '^nmb.service' && UNITS="smb nmb"
  fi
elif command -v rc-service >/dev/null 2>&1; then
  INIT=openrc; SVC=samba; UNITS=samba
fi
`;

/** Makes sure smb.conf exists and ends with the include of the managed file. */
export const ENSURE_INCLUDE = `
CONF=/etc/samba/termix.conf
MAIN=/etc/samba/smb.conf
mkdir -p /etc/samba
[ -f "$MAIN" ] || printf '[global]\\n   workgroup = WORKGROUP\\n   server role = standalone server\\n   map to guest = bad user\\n' > "$MAIN"
[ -f "$CONF" ] || { printf '# Managed by Termix. Shares below are rewritten by the plugin.\\n' > "$CONF"; chmod 644 "$CONF"; }
if ! grep -qE '^[[:space:]]*include[[:space:]]*=[[:space:]]*/etc/samba/termix.conf[[:space:]]*$' "$MAIN"; then
  [ -f "$MAIN.termix.bak" ] || cp -p "$MAIN" "$MAIN.termix.bak"
  printf '\\n# Termix managed shares\\ninclude = %s\\n' "$CONF" >> "$MAIN"
fi
`;
