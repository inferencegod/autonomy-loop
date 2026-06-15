# VHS tape -> renders demo/demo.gif for the README.
# Install: https://github.com/charmbracelet/vhs  then:  vhs demo/demo.tape
# This is a SCRIPTED walkthrough of the install + one loop tick. Replace the echoed lines with a
# real recording once you have a sample project wired up.
Output demo/demo.gif
Set FontSize 18
Set Width 1200
Set Height 720
Set Theme "Catppuccin Mocha"
Set Padding 20

Type "# autonomy-loop: two terminals, one repo, a git baton"
Enter
Sleep 1s
Type "claude plugin marketplace add inferencegod/autonomy-loop"
Enter
Sleep 1500ms
Type "claude plugin install autonomy-loop"
Enter
Sleep 1500ms
Type "/autonomy-loop:autonomy-init    # scaffolds autonomy.config.json + LOOP-STATE.md"
Enter
Sleep 2s
Type "cat LOOP-STATE.md"
Enter
Sleep 500ms
Type "# turn: builder"
Enter
Type "# last-builder-sha: -"
Enter
Type "# pending-for-builder: implement first task + RED->GREEN test"
Enter
Sleep 2s
Type "# T1: /autonomy-loop:builder then /loop 600   |   T2: /autonomy-loop:reviewer then /loop 600"
Enter
Sleep 2s
