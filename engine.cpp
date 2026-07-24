#include <iostream>
#include <vector>
#include <string>
#include <sstream>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <map>

using namespace std;

enum Color { WHITE, BLACK, NONE_COLOR };
enum PieceType { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, EMPTY };

struct Piece {
    PieceType type = EMPTY;
    Color color = NONE_COLOR;
};

struct Move {
    int fromRow, fromCol, toRow, toCol;
    PieceType promotion = EMPTY;
    bool isCastle = false;
    bool isEnPassant = false;

    string toUCI() const {
        string uci = "";
        uci += (char)('a' + fromCol);
        uci += to_string(8 - fromRow);
        uci += (char)('a' + toCol);
        uci += to_string(8 - toRow);
        if (promotion == QUEEN) uci += "q";
        else if (promotion == ROOK) uci += "r";
        else if (promotion == BISHOP) uci += "b";
        else if (promotion == KNIGHT) uci += "n";
        return uci;
    }
};

const int PIECE_VALUES[7] = { 100, 320, 330, 500, 900, 20000, 0 };

// Piece-Square Tables for positional evaluation
const int PAWN_PST[8][8] = {
    { 0,  0,  0,  0,  0,  0,  0,  0},
    {50, 50, 50, 50, 50, 50, 50, 50},
    {10, 10, 20, 30, 30, 20, 10, 10},
    { 5,  5, 10, 25, 25, 10,  5,  5},
    { 0,  0,  0, 20, 20,  0,  0,  0},
    { 5, -5,-10,  0,  0,-10, -5,  5},
    { 5, 10, 10,-20,-20, 10, 10,  5},
    { 0,  0,  0,  0,  0,  0,  0,  0}
};

const int KNIGHT_PST[8][8] = {
    {-50,-40,-30,-30,-30,-30,-40,-50},
    {-40,-20,  0,  0,  0,  0,-20,-40},
    {-30,  0, 10, 15, 15, 10,  0,-30},
    {-30,  5, 15, 20, 20, 15,  5,-30},
    {-30,  0, 15, 20, 20, 15,  0,-30},
    {-30,  5, 10, 15, 15, 10,  5,-30},
    {-40,-20,  0,  5,  5,  0,-20,-40},
    {-50,-40,-30,-30,-30,-30,-40,-50}
};

const int BISHOP_PST[8][8] = {
    {-20,-10,-10,-10,-10,-10,-10,-20},
    {-10,  0,  0,  0,  0,  0,  0,-10},
    {-10,  0,  5, 10, 10,  5,  0,-10},
    {-10,  5,  5, 10, 10,  5,  5,-10},
    {-10,  0, 10, 10, 10, 10,  0,-10},
    {-10, 10, 10, 10, 10, 10, 10,-10},
    {-10,  5,  0,  0,  0,  0,  5,-10},
    {-20,-10,-10,-10,-10,-10,-10,-20}
};

class Board {
public:
    Piece squares[8][8];
    Color sideToMove = WHITE;
    bool whiteKingSideCastle = true, whiteQueenSideCastle = true;
    bool blackKingSideCastle = true, blackQueenSideCastle = true;
    int enPassantRow = -1, enPassantCol = -1;
    int halfMoveClock = 0;
    int fullMoveNumber = 1;

    Board() {
        resetBoard();
    }

    void resetBoard() {
        for (int r = 0; r < 8; r++) {
            for (int c = 0; c < 8; c++) {
                squares[r][c] = { EMPTY, NONE_COLOR };
            }
        }
    }

    void loadFEN(const string& fen) {
        resetBoard();
        stringstream ss(fen);
        string boardStr, turnStr, castleStr, epStr;
        ss >> boardStr >> turnStr >> castleStr >> epStr;

        int row = 0, col = 0;
        for (char ch : boardStr) {
            if (ch == '/') {
                row++;
                col = 0;
            } else if (isdigit(ch)) {
                col += ch - '0';
            } else {
                Color color = isupper(ch) ? WHITE : BLACK;
                char lower = tolower(ch);
                PieceType type = EMPTY;
                if (lower == 'p') type = PAWN;
                else if (lower == 'n') type = KNIGHT;
                else if (lower == 'b') type = BISHOP;
                else if (lower == 'r') type = ROOK;
                else if (lower == 'q') type = QUEEN;
                else if (lower == 'k') type = KING;
                squares[row][col] = { type, color };
                col++;
            }
        }

        sideToMove = (turnStr == "w") ? WHITE : BLACK;
        whiteKingSideCastle = castleStr.find('K') != string::npos;
        whiteQueenSideCastle = castleStr.find('Q') != string::npos;
        blackKingSideCastle = castleStr.find('k') != string::npos;
        blackQueenSideCastle = castleStr.find('q') != string::npos;

        if (epStr != "-" && epStr.length() >= 2) {
            enPassantCol = epStr[0] - 'a';
            enPassantRow = 8 - (epStr[1] - '0');
        } else {
            enPassantRow = -1;
            enPassantCol = -1;
        }
    }

    string toFEN() const {
        stringstream fen;
        for (int r = 0; r < 8; r++) {
            int emptyCount = 0;
            for (int c = 0; c < 8; c++) {
                if (squares[r][c].type == EMPTY) {
                    emptyCount++;
                } else {
                    if (emptyCount > 0) {
                        fen << emptyCount;
                        emptyCount = 0;
                    }
                    char p = ' ';
                    switch (squares[r][c].type) {
                        case PAWN: p = 'p'; break;
                        case KNIGHT: p = 'n'; break;
                        case BISHOP: p = 'b'; break;
                        case ROOK: p = 'r'; break;
                        case QUEEN: p = 'q'; break;
                        case KING: p = 'k'; break;
                        default: break;
                    }
                    if (squares[r][c].color == WHITE) p = toupper(p);
                    fen << p;
                }
            }
            if (emptyCount > 0) fen << emptyCount;
            if (r < 7) fen << "/";
        }

        fen << " " << (sideToMove == WHITE ? "w" : "b") << " ";

        string castle = "";
        if (whiteKingSideCastle) castle += "K";
        if (whiteQueenSideCastle) castle += "Q";
        if (blackKingSideCastle) castle += "k";
        if (blackQueenSideCastle) castle += "q";
        if (castle.empty()) castle = "-";
        fen << castle << " ";

        if (enPassantRow != -1 && enPassantCol != -1) {
            fen << (char)('a' + enPassantCol) << (8 - enPassantRow);
        } else {
            fen << "-";
        }

        fen << " " << halfMoveClock << " " << fullMoveNumber;
        return fen.str();
    }

    bool inside(int r, int c) const {
        return r >= 0 && r < 8 && c >= 0 && c < 8;
    }

    void generateLegalMoves(vector<Move>& moves) const {
        Color us = sideToMove;
        Color enemy = (us == WHITE) ? BLACK : WHITE;

        for (int r = 0; r < 8; r++) {
            for (int c = 0; c < 8; c++) {
                if (squares[r][c].color != us) continue;
                PieceType pt = squares[r][c].type;

                if (pt == PAWN) {
                    int dir = (us == WHITE) ? -1 : 1;
                    int startRow = (us == WHITE) ? 6 : 1;

                    // Push 1
                    if (inside(r + dir, c) && squares[r + dir][c].type == EMPTY) {
                        if ((us == WHITE && r + dir == 0) || (us == BLACK && r + dir == 7)) {
                            moves.push_back({ r, c, r + dir, c, QUEEN });
                            moves.push_back({ r, c, r + dir, c, ROOK });
                            moves.push_back({ r, c, r + dir, c, BISHOP });
                            moves.push_back({ r, c, r + dir, c, KNIGHT });
                        } else {
                            moves.push_back({ r, c, r + dir, c });
                            // Push 2
                            if (r == startRow && squares[r + 2 * dir][c].type == EMPTY) {
                                moves.push_back({ r, c, r + 2 * dir, c });
                            }
                        }
                    }

                    // Captures
                    for (int dc : {-1, 1}) {
                        int nc = c + dc;
                        int nr = r + dir;
                        if (inside(nr, nc)) {
                            if (squares[nr][nc].color == enemy) {
                                if ((us == WHITE && nr == 0) || (us == BLACK && nr == 7)) {
                                    moves.push_back({ r, c, nr, nc, QUEEN });
                                    moves.push_back({ r, c, nr, nc, ROOK });
                                    moves.push_back({ r, c, nr, nc, BISHOP });
                                    moves.push_back({ r, c, nr, nc, KNIGHT });
                                } else {
                                    moves.push_back({ r, c, nr, nc });
                                }
                            }
                            // En Passant
                            if (nr == enPassantRow && nc == enPassantCol) {
                                Move m = { r, c, nr, nc };
                                m.isEnPassant = true;
                                moves.push_back(m);
                            }
                        }
                    }
                } else if (pt == KNIGHT) {
                    static const int kRow[] = {-2, -2, -1, -1, 1, 1, 2, 2};
                    static const int kCol[] = {-1, 1, -2, 2, -2, 2, -1, 1};
                    for (int i = 0; i < 8; i++) {
                        int nr = r + kRow[i], nc = c + kCol[i];
                        if (inside(nr, nc) && squares[nr][nc].color != us) {
                            moves.push_back({ r, c, nr, nc });
                        }
                    }
                } else if (pt == BISHOP || pt == ROOK || pt == QUEEN) {
                    vector<pair<int, int>> dirs;
                    if (pt == BISHOP || pt == QUEEN) {
                        dirs.push_back({-1, -1}); dirs.push_back({-1, 1});
                        dirs.push_back({1, -1});  dirs.push_back({1, 1});
                    }
                    if (pt == ROOK || pt == QUEEN) {
                        dirs.push_back({-1, 0}); dirs.push_back({1, 0});
                        dirs.push_back({0, -1}); dirs.push_back({0, 1});
                    }
                    for (auto d : dirs) {
                        int nr = r + d.first, nc = c + d.second;
                        while (inside(nr, nc)) {
                            if (squares[nr][nc].type == EMPTY) {
                                moves.push_back({ r, c, nr, nc });
                            } else {
                                if (squares[nr][nc].color == enemy) {
                                    moves.push_back({ r, c, nr, nc });
                                }
                                break;
                            }
                            nr += d.first;
                            nc += d.second;
                        }
                    }
                } else if (pt == KING) {
                    for (int dr = -1; dr <= 1; dr++) {
                        for (int dc = -1; dc <= 1; dc++) {
                            if (dr == 0 && dc == 0) continue;
                            int nr = r + dr, nc = c + dc;
                            if (inside(nr, nc) && squares[nr][nc].color != us) {
                                moves.push_back({ r, c, nr, nc });
                            }
                        }
                    }
                    // Castling
                    if (us == WHITE && r == 7 && c == 4) {
                        if (whiteKingSideCastle && squares[7][5].type == EMPTY && squares[7][6].type == EMPTY && squares[7][7].type == ROOK) {
                            Move m = { 7, 4, 7, 6 }; m.isCastle = true; moves.push_back(m);
                        }
                        if (whiteQueenSideCastle && squares[7][3].type == EMPTY && squares[7][2].type == EMPTY && squares[7][1].type == EMPTY && squares[7][0].type == ROOK) {
                            Move m = { 7, 4, 7, 2 }; m.isCastle = true; moves.push_back(m);
                        }
                    } else if (us == BLACK && r == 0 && c == 4) {
                        if (blackKingSideCastle && squares[0][5].type == EMPTY && squares[0][6].type == EMPTY && squares[0][7].type == ROOK) {
                            Move m = { 0, 4, 0, 6 }; m.isCastle = true; moves.push_back(m);
                        }
                        if (blackQueenSideCastle && squares[0][3].type == EMPTY && squares[0][2].type == EMPTY && squares[0][1].type == EMPTY && squares[0][0].type == ROOK) {
                            Move m = { 0, 4, 0, 2 }; m.isCastle = true; moves.push_back(m);
                        }
                    }
                }
            }
        }
    }

    void makeMove(const Move& m, Board& nextBoard) const {
        nextBoard = *this;
        Piece p = nextBoard.squares[m.fromRow][m.fromCol];
        nextBoard.squares[m.fromRow][m.fromCol] = { EMPTY, NONE_COLOR };

        if (m.promotion != EMPTY) {
            p.type = m.promotion;
        }

        nextBoard.squares[m.toRow][m.toCol] = p;

        if (m.isCastle) {
            if (m.toRow == 7 && m.toCol == 6) {
                nextBoard.squares[7][7] = { EMPTY, NONE_COLOR };
                nextBoard.squares[7][5] = { ROOK, WHITE };
            } else if (m.toRow == 7 && m.toCol == 2) {
                nextBoard.squares[7][0] = { EMPTY, NONE_COLOR };
                nextBoard.squares[7][3] = { ROOK, WHITE };
            } else if (m.toRow == 0 && m.toCol == 6) {
                nextBoard.squares[0][7] = { EMPTY, NONE_COLOR };
                nextBoard.squares[0][5] = { ROOK, BLACK };
            } else if (m.toRow == 0 && m.toCol == 2) {
                nextBoard.squares[0][0] = { EMPTY, NONE_COLOR };
                nextBoard.squares[0][3] = { ROOK, BLACK };
            }
        }

        if (m.isEnPassant) {
            int epCapturedRow = (sideToMove == WHITE) ? m.toRow + 1 : m.toRow - 1;
            nextBoard.squares[epCapturedRow][m.toCol] = { EMPTY, NONE_COLOR };
        }

        if (p.type == PAWN && abs(m.toRow - m.fromRow) == 2) {
            nextBoard.enPassantRow = (m.fromRow + m.toRow) / 2;
            nextBoard.enPassantCol = m.fromCol;
        } else {
            nextBoard.enPassantRow = -1;
            nextBoard.enPassantCol = -1;
        }

        if (p.type == KING) {
            if (sideToMove == WHITE) { nextBoard.whiteKingSideCastle = false; nextBoard.whiteQueenSideCastle = false; }
            else { nextBoard.blackKingSideCastle = false; nextBoard.blackQueenSideCastle = false; }
        }
        if (m.fromRow == 7 && m.fromCol == 7) nextBoard.whiteKingSideCastle = false;
        if (m.fromRow == 7 && m.fromCol == 0) nextBoard.whiteQueenSideCastle = false;
        if (m.fromRow == 0 && m.fromCol == 7) nextBoard.blackKingSideCastle = false;
        if (m.fromRow == 0 && m.fromCol == 0) nextBoard.blackQueenSideCastle = false;

        nextBoard.sideToMove = (sideToMove == WHITE) ? BLACK : WHITE;
        if (sideToMove == BLACK) nextBoard.fullMoveNumber++;
    }

    int evaluate() const {
        int eval = 0;
        for (int r = 0; r < 8; r++) {
            for (int c = 0; c < 8; c++) {
                Piece p = squares[r][c];
                if (p.type == EMPTY) continue;

                int val = PIECE_VALUES[p.type];
                int pst = 0;
                int rIdx = (p.color == WHITE) ? r : 7 - r;

                if (p.type == PAWN) pst = PAWN_PST[rIdx][c];
                else if (p.type == KNIGHT) pst = KNIGHT_PST[rIdx][c];
                else if (p.type == BISHOP) pst = BISHOP_PST[rIdx][c];

                int totalVal = val + pst;
                if (p.color == WHITE) eval += totalVal;
                else eval -= totalVal;
            }
        }
        return eval;
    }
};

struct SearchResult {
    int score;
    Move bestMove;
    long long nodesSearched;
};

// MVV-LVA move ordering helper
int scoreMove(const Board& board, const Move& m) {
    Piece target = board.squares[m.toRow][m.toCol];
    Piece attacker = board.squares[m.fromRow][m.fromCol];
    int score = 0;
    if (target.type != EMPTY) {
        score += 10 * PIECE_VALUES[target.type] - PIECE_VALUES[attacker.type];
    }
    if (m.promotion == QUEEN) score += 900;
    return score;
}

SearchResult minimax(const Board& board, int depth, int alpha, int beta, bool maximizingPlayer, long long& nodeCount) {
    nodeCount++;
    if (depth == 0 || nodeCount > 2000000) {
        return { board.evaluate(), {0,0,0,0}, nodeCount };
    }

    vector<Move> moves;
    board.generateLegalMoves(moves);

    if (moves.empty()) {
        int score = board.evaluate();
        return { score, {0,0,0,0}, nodeCount };
    }

    // Sort moves for high-efficiency Alpha-Beta Pruning
    vector<pair<int, Move>> scoredMoves;
    scoredMoves.reserve(moves.size());
    for (const auto& m : moves) {
        scoredMoves.push_back({ scoreMove(board, m), m });
    }
    sort(scoredMoves.begin(), scoredMoves.end(), [](const pair<int, Move>& a, const pair<int, Move>& b) {
        return a.first > b.first;
    });

    Move bestMove = scoredMoves[0].second;

    if (maximizingPlayer) {
        int maxEval = -1000000;
        for (const auto& item : scoredMoves) {
            Board nextBoard;
            board.makeMove(item.second, nextBoard);
            SearchResult res = minimax(nextBoard, depth - 1, alpha, beta, false, nodeCount);
            if (res.score > maxEval) {
                maxEval = res.score;
                bestMove = item.second;
            }
            alpha = max(alpha, res.score);
            if (beta <= alpha) break;
        }
        return { maxEval, bestMove, nodeCount };
    } else {
        int minEval = 1000000;
        for (const auto& item : scoredMoves) {
            Board nextBoard;
            board.makeMove(item.second, nextBoard);
            SearchResult res = minimax(nextBoard, depth - 1, alpha, beta, true, nodeCount);
            if (res.score < minEval) {
                minEval = res.score;
                bestMove = item.second;
            }
            beta = min(beta, res.score);
            if (beta <= alpha) break;
        }
        return { minEval, bestMove, nodeCount };
    }
}

string escapeJSON(const string& s) {
    ostringstream o;
    for (char c : s) {
        if (c == '"') o << "\\\"";
        else if (c == '\\') o << "\\\\";
        else o << c;
    }
    return o.str();
}

int main(int argc, char* argv[]) {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    string fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    int depth = 4;

    if (argc >= 2) fen = argv[1];
    if (argc >= 3) depth = atoi(argv[2]);

    // Cap maximum requested depth to 6 to prevent server timeouts
    if (depth > 6) depth = 6;

    Board board;
    board.loadFEN(fen);

    vector<Move> legalMoves;
    board.generateLegalMoves(legalMoves);

    auto startTime = chrono::high_resolution_clock::now();
    long long nodeCount = 0;
    bool isWhite = (board.sideToMove == WHITE);

    SearchResult result = minimax(board, depth, -1000000, 1000000, isWhite, nodeCount);
    auto endTime = chrono::high_resolution_clock::now();

    double elapsedMs = chrono::duration<double, milli>(endTime - startTime).count();
    double nps = (elapsedMs > 0) ? (nodeCount / (elapsedMs / 1000.0)) : 0;

    Board nextBoard;
    string nextFEN = fen;
    string bestMoveUCI = "";
    if (!legalMoves.empty()) {
        bestMoveUCI = result.bestMove.toUCI();
        board.makeMove(result.bestMove, nextBoard);
        nextFEN = nextBoard.toFEN();
    }

    cout << "{\n";
    cout << "  \"status\": \"success\",\n";
    cout << "  \"best_move\": \"" << bestMoveUCI << "\",\n";
    cout << "  \"eval\": " << result.score << ",\n";
    cout << "  \"depth\": " << depth << ",\n";
    cout << "  \"nodes\": " << nodeCount << ",\n";
    cout << "  \"time_ms\": " << elapsedMs << ",\n";
    cout << "  \"nps\": " << (long long)nps << ",\n";
    cout << "  \"fen\": \"" << escapeJSON(fen) << "\",\n";
    cout << "  \"next_fen\": \"" << escapeJSON(nextFEN) << "\",\n";
    cout << "  \"legal_moves\": [";
    for (size_t i = 0; i < legalMoves.size(); i++) {
        cout << "\"" << legalMoves[i].toUCI() << "\"" << (i + 1 < legalMoves.size() ? ", " : "");
    }
    cout << "]\n";
    cout << "}\n";

    return 0;
}
