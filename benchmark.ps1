$positions = @(
    @{name="Starting Position"; fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"},
    @{name="Italian Game"; fen="r1bqkb1r/pppppppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4"},
    @{name="Sicilian Defense"; fen="rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"},
    @{name="Queens Gambit"; fen="rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 2"},
    @{name="Middle Game"; fen="r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"},
    @{name="Complex Middlegame"; fen="r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQ - 0 6"}
)

$depths = @(3, 4, 5)

Write-Host "=" * 100
Write-Host "BENCHMARK: Original Engine vs Optimized Engine"
Write-Host "=" * 100

foreach ($depth in $depths) {
    Write-Host ""
    Write-Host "--- Depth $depth ---"
    Write-Host ("{0,-25} {1,-12} {2,-12} {3,-12} {4,-10} {5,-10}" -f "Position", "Engine", "Nodes", "Time(ms)", "NPS", "Best Move")
    Write-Host ("-" * 80)

    foreach ($pos in $positions) {
        $origResult = & "C:\Users\trisa\OneDrive\Desktop\Signoz_Hackathon\chess_engine\SIgnoz_Hackathon\engine_original.exe" $pos.fen $depth 2>&1 | ConvertFrom-Json
        $optResult = & "C:\Users\trisa\OneDrive\Desktop\Signoz_Hackathon\chess_engine\SIgnoz_Hackathon\engine.exe" $pos.fen $depth 5000 2>&1 | ConvertFrom-Json

        Write-Host ("{0,-25} {1,-12} {2,-12} {3,-12} {4,-10} {5,-10}" -f $pos.name, "Original", $origResult.nodes, $origResult.time_ms.ToString("F1"), $origResult.nps, $origResult.best_move)
        Write-Host ("{0,-25} {1,-12} {2,-12} {3,-12} {4,-10} {5,-10}" -f "", "Optimized", $optResult.nodes, $optResult.time_ms.ToString("F1"), $optResult.nps, $optResult.best_move)

        if ($origResult.nodes -gt 0) {
            $ratio = [math]::Round($origResult.nodes / [math]::Max($optResult.nodes, 1), 2)
            Write-Host ("{0,-25} {1,-12}" -f "", "Node ratio: ${ratio}x")
        }
        Write-Host ""
    }
}
