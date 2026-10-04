param(
    [Parameter(Mandatory)][int]$AppProcessId,
    [Parameter(Mandatory)][ValidateSet('accept', 'dismiss', 'save', 'directory', 'inspect')][string]$Action,
    [string]$FilePath
)
$ErrorActionPreference = 'Stop'
if ((Get-Process -Id $AppProcessId).ProcessName -ne 'framemind-studio') {
    throw 'The dialog helper only controls FrameMind Studio.'
}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class StudioDialogSmoke {
    public delegate bool EnumCallback(IntPtr hwnd, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hwnd, int id);
    [DllImport("user32.dll", EntryPoint="SendMessageW")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] public static extern IntPtr ReadText(IntPtr hwnd, uint message, IntPtr wParam, StringBuilder text);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    public static IntPtr FindDialog(uint targetProcessId) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, _) => {
            uint processId; GetWindowThreadProcessId(hwnd, out processId);
            var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity);
            if (processId == targetProcessId && name.ToString() == "#32770" && IsWindowVisible(hwnd)) { found = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static IntPtr FindPathEdit(IntPtr parent, int controlId) {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (hwnd, _) => {
            var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity);
            if (name.ToString() == "Edit" && GetDlgCtrlID(hwnd) == controlId) { found = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static string DescribeWindows(uint targetProcessId) {
        var result = new StringBuilder();
        EnumWindows((hwnd, _) => {
            uint processId; GetWindowThreadProcessId(hwnd, out processId);
            if (processId == targetProcessId) {
                var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity);
                var title = new StringBuilder(512); GetWindowText(hwnd, title, title.Capacity);
                result.AppendLine(name + ": " + title);
            }
            return true;
        }, IntPtr.Zero);
        return result.ToString();
    }
    public static IntPtr FindConfirmationButton(IntPtr parent, bool dismiss) {
        IntPtr found = IntPtr.Zero;
        var captions = dismiss ? new[] { "Cancel", "Zrušit", "No", "Ne" } : new[] { "OK", "Yes", "Ano" };
        EnumChildWindows(parent, (hwnd, _) => {
            var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity);
            if (name.ToString() != "Button" || !IsWindowVisible(hwnd)) return true;
            var title = new StringBuilder(256); GetWindowText(hwnd, title, title.Capacity);
            var caption = title.ToString().Replace("&", "").Trim();
            foreach (var expected in captions) {
                if (string.Equals(caption, expected, StringComparison.OrdinalIgnoreCase)) { found = hwnd; return false; }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static string DescribeChildren(IntPtr parent) {
        var result = new StringBuilder();
        EnumChildWindows(parent, (hwnd, _) => {
            var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity);
            var title = new StringBuilder(512); GetWindowText(hwnd, title, title.Capacity);
            if (name.ToString() == "Edit") ReadText(hwnd, 0x000D, (IntPtr)title.Capacity, title);
            result.AppendLine(GetDlgCtrlID(hwnd) + " " + name + ": " + title);
            return true;
        }, IntPtr.Zero);
        return result.ToString();
    }
}
'@
$deadline = [DateTime]::UtcNow.AddSeconds(20)
$dialog = [IntPtr]::Zero
while ($dialog -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline) {
    $dialog = [StudioDialogSmoke]::FindDialog($AppProcessId)
    if ($dialog -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 100 }
}
if ($dialog -eq [IntPtr]::Zero) { throw ('FrameMind Studio dialog did not appear. ' + [StudioDialogSmoke]::DescribeWindows($AppProcessId)) }
if ($Action -eq 'inspect') {
    Write-Output ([StudioDialogSmoke]::DescribeChildren($dialog))
    exit
}
if ($Action -in @('save', 'directory')) {
    if (!$FilePath) { throw 'A test export path is required.' }
    $controlId = if ($Action -eq 'directory') { 1152 } else { 1001 }
    $edit = [StudioDialogSmoke]::FindPathEdit($dialog, $controlId)
    if ($edit -eq [IntPtr]::Zero) { throw 'The dialog filename field was not found.' }
    # WM_SETTEXT changes the field without updating the common dialog's chosen path.
    # Send character input to this dialog's edit control, then verify its contents.
    [void][StudioDialogSmoke]::SendMessage($edit, 0x00B1, [IntPtr]::Zero, [IntPtr]::new(-1))
    foreach ($character in $FilePath.ToCharArray()) {
        [void][StudioDialogSmoke]::SendMessage($edit, 0x0102, [IntPtr]::new([int]$character), [IntPtr]::Zero)
    }
    $fieldValue = [System.Text.StringBuilder]::new(4096)
    [void][StudioDialogSmoke]::ReadText($edit, 0x000D, [IntPtr]::new($fieldValue.Capacity), $fieldValue)
    if ($fieldValue.ToString() -ne $FilePath) { throw 'The dialog filename did not match the test path.' }
}
$buttonIds = if ($Action -eq 'dismiss') { @(7, 2) } elseif ($Action -eq 'accept') { @(6, 1) } else { @(1) }
$button = [IntPtr]::Zero
foreach ($buttonId in $buttonIds) {
    $button = [StudioDialogSmoke]::GetDlgItem($dialog, $buttonId)
    if ($button -ne [IntPtr]::Zero) { break }
}
if ($button -eq [IntPtr]::Zero -and $Action -in @('accept', 'dismiss')) {
    $button = [StudioDialogSmoke]::FindConfirmationButton($dialog, $Action -eq 'dismiss')
}
if ($button -eq [IntPtr]::Zero) { throw ('The expected dialog button was not found. ' + [StudioDialogSmoke]::DescribeChildren($dialog)) }
[void][StudioDialogSmoke]::PostMessage($button, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output "FrameMind Studio dialog: $Action"
