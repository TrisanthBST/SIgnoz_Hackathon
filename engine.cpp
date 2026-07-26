#include <iostream>
#include <vector>
#include <string>
#include <sstream>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <cstdint>
#include <random>

using namespace std;

mt19937 rng(42);

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

    bool operator==(const Move& o) const {
        return fromRow==o.fromRow && fromCol==o.fromCol && toRow==o.toRow && toCol==o.toCol && promotion==o.promotion;
    }
};

const int PIECE_VALUES[7] = { 100, 320, 330, 500, 900, 20000, 0 };

int gRandomChance = 0;
int gEvalNoise = 0;
int gMaxQDepth = 8;

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

const int ROOK_PST[8][8] = {
    { 0,  0,  0,  0,  0,  0,  0,  0},
    { 5, 10, 10, 10, 10, 10, 10,  5},
    {-5,  0,  0,  0,  0,  0,  0, -5},
    {-5,  0,  0,  0,  0,  0,  0, -5},
    {-5,  0,  0,  0,  0,  0,  0, -5},
    {-5,  0,  0,  0,  0,  0,  0, -5},
    {-5,  0,  0,  0,  0,  0,  0, -5},
    { 0,  0,  0,  5,  5,  0,  0,  0}
};

const int QUEEN_PST_MG[8][8] = {
    {-20,-10,-10, -5, -5,-10,-10,-20},
    {-10,  0,  0,  0,  0,  0,  0,-10},
    {-10,  0,  5,  5,  5,  5,  0,-10},
    { -5,  0,  5,  5,  5,  5,  0, -5},
    {  0,  0,  5,  5,  5,  5,  0, -5},
    {-10,  5,  5,  5,  5,  5,  0,-10},
    {-10,  0,  5,  0,  0,  0,  0,-10},
    {-20,-10,-10, -5, -5,-10,-10,-20}
};

const int KING_PST_MG[8][8] = {
    {-30,-40,-40,-50,-50,-40,-40,-30},
    {-30,-40,-40,-50,-50,-40,-40,-30},
    {-30,-40,-40,-50,-50,-40,-40,-30},
    {-30,-40,-40,-50,-50,-40,-40,-30},
    {-20,-30,-30,-40,-40,-30,-30,-20},
    {-10,-20,-20,-20,-20,-20,-20,-10},
    { 20, 20,  0,  0,  0,  0, 20, 20},
    { 20, 30, 10,  0,  0, 10, 30, 20}
};

const int KING_PST_EG[8][8] = {
    {-50,-40,-30,-20,-20,-30,-40,-50},
    {-30,-20,-10,  0,  0,-10,-20,-30},
    {-30,-10, 20, 30, 30, 20,-10,-30},
    {-30,-10, 30, 40, 40, 30,-10,-30},
    {-30,-10, 30, 40, 40, 30,-10,-30},
    {-30,-10, 20, 30, 30, 20,-10,-30},
    {-30,-30,  0,  0,  0,  0,-30,-30},
    {-50,-30,-30,-30,-30,-30,-30,-50}
};

struct TTEntry {
    uint64_t hash;
    int score;
    int depth;
    uint8_t flag;
    Move bestMove;
};

enum { TT_EXACT, TT_ALPHA, TT_BETA };

class Board {
public:
    Piece squares[8][8];
    Color sideToMove = WHITE;
    bool whiteKingSideCastle = true, whiteQueenSideCastle = true;
    bool blackKingSideCastle = true, blackQueenSideCastle = true;
    int enPassantRow = -1, enPassantCol = -1;
    int halfMoveClock = 0;
    int fullMoveNumber = 1;
    uint64_t zobristHash = 0;

    Board() { resetBoard(); }

    void resetBoard() {
        for (int r = 0; r < 8; r++)
            for (int c = 0; c < 8; c++)
                squares[r][c] = { EMPTY, NONE_COLOR };
    }

    bool inside(int r, int c) const { return r >= 0 && r < 8 && c >= 0 && c < 8; }

    void loadFEN(const string& fen) {
        resetBoard();
        stringstream ss(fen);
        string boardStr, turnStr, castleStr, epStr;
        ss >> boardStr >> turnStr >> castleStr >> epStr;
        int row = 0, col = 0;
        for (char ch : boardStr) {
            if (ch == '/') { row++; col = 0; }
            else if (isdigit(ch)) { col += ch - '0'; }
            else {
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
        computeHash();
    }

    string toFEN() const {
        stringstream fen;
        for (int r = 0; r < 8; r++) {
            int emptyCount = 0;
            for (int c = 0; c < 8; c++) {
                if (squares[r][c].type == EMPTY) { emptyCount++; }
                else {
                    if (emptyCount > 0) { fen << emptyCount; emptyCount = 0; }
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
        if (enPassantRow != -1 && enPassantCol != -1)
            fen << (char)('a' + enPassantCol) << (8 - enPassantRow);
        else
            fen << "-";
        fen << " " << halfMoveClock << " " << fullMoveNumber;
        return fen.str();
    }

    bool isSquareAttacked(int row, int col, Color byColor) const {
        int pawnDir = (byColor == WHITE) ? 1 : -1;
        if (inside(row + pawnDir, col - 1) && squares[row + pawnDir][col - 1].type == PAWN && squares[row + pawnDir][col - 1].color == byColor) return true;
        if (inside(row + pawnDir, col + 1) && squares[row + pawnDir][col + 1].type == PAWN && squares[row + pawnDir][col + 1].color == byColor) return true;
        static const int knr[] = {-2,-2,-1,-1,1,1,2,2};
        static const int knc[] = {-1,1,-2,2,-2,2,-1,1};
        for (int i = 0; i < 8; i++) {
            int nr = row + knr[i], nc = col + knc[i];
            if (inside(nr, nc) && squares[nr][nc].type == KNIGHT && squares[nr][nc].color == byColor) return true;
        }
        static const int bdr[] = {-1,-1,1,1};
        static const int bdc[] = {-1,1,-1,1};
        for (int d = 0; d < 4; d++) {
            int nr = row + bdr[d], nc = col + bdc[d];
            while (inside(nr, nc)) {
                if (squares[nr][nc].type != EMPTY) {
                    if (squares[nr][nc].color == byColor && (squares[nr][nc].type == BISHOP || squares[nr][nc].type == QUEEN)) return true;
                    break;
                }
                nr += bdr[d]; nc += bdc[d];
            }
        }
        static const int rdr[] = {-1,1,0,0};
        static const int rdc[] = {0,0,-1,1};
        for (int d = 0; d < 4; d++) {
            int nr = row + rdr[d], nc = col + rdc[d];
            while (inside(nr, nc)) {
                if (squares[nr][nc].type != EMPTY) {
                    if (squares[nr][nc].color == byColor && (squares[nr][nc].type == ROOK || squares[nr][nc].type == QUEEN)) return true;
                    break;
                }
                nr += rdr[d]; nc += rdc[d];
            }
        }
        for (int dr = -1; dr <= 1; dr++) {
            for (int dc = -1; dc <= 1; dc++) {
                if (dr == 0 && dc == 0) continue;
                int nr = row + dr, nc = col + dc;
                if (inside(nr, nc) && squares[nr][nc].type == KING && squares[nr][nc].color == byColor) return true;
            }
        }
        return false;
    }

    bool isKingInCheck(Color kingColor) const {
        for (int r = 0; r < 8; r++)
            for (int c = 0; c < 8; c++)
                if (squares[r][c].type == KING && squares[r][c].color == kingColor)
                    return isSquareAttacked(r, c, kingColor == WHITE ? BLACK : WHITE);
        return false;
    }

    void generatePseudoLegalMoves(vector<Move>& moves) const {
        Color us = sideToMove;
        Color enemy = (us == WHITE) ? BLACK : WHITE;
        for (int r = 0; r < 8; r++) {
            for (int c = 0; c < 8; c++) {
                if (squares[r][c].color != us) continue;
                PieceType pt = squares[r][c].type;
                if (pt == PAWN) {
                    int dir = (us == WHITE) ? -1 : 1;
                    int startRow = (us == WHITE) ? 6 : 1;
                    if (inside(r + dir, c) && squares[r + dir][c].type == EMPTY) {
                        if ((us == WHITE && r + dir == 0) || (us == BLACK && r + dir == 7)) {
                            moves.push_back({r, c, r + dir, c, QUEEN});
                            moves.push_back({r, c, r + dir, c, ROOK});
                            moves.push_back({r, c, r + dir, c, BISHOP});
                            moves.push_back({r, c, r + dir, c, KNIGHT});
                        } else {
                            moves.push_back({r, c, r + dir, c});
                            if (r == startRow && squares[r + 2 * dir][c].type == EMPTY)
                                moves.push_back({r, c, r + 2 * dir, c});
                        }
                    }
                    for (int dc : {-1, 1}) {
                        int nc = c + dc, nr = r + dir;
                        if (inside(nr, nc)) {
                            if (squares[nr][nc].color == enemy) {
                                if ((us == WHITE && nr == 0) || (us == BLACK && nr == 7)) {
                                    moves.push_back({r, c, nr, nc, QUEEN});
                                    moves.push_back({r, c, nr, nc, ROOK});
                                    moves.push_back({r, c, nr, nc, BISHOP});
                                    moves.push_back({r, c, nr, nc, KNIGHT});
                                } else {
                                    moves.push_back({r, c, nr, nc});
                                }
                            }
                            if (nr == enPassantRow && nc == enPassantCol) {
                                Move m = {r, c, nr, nc}; m.isEnPassant = true;
                                moves.push_back(m);
                            }
                        }
                    }
                } else if (pt == KNIGHT) {
                    static const int kRow[] = {-2,-2,-1,-1,1,1,2,2};
                    static const int kCol[] = {-1,1,-2,2,-2,2,-1,1};
                    for (int i = 0; i < 8; i++) {
                        int nr = r + kRow[i], nc = c + kCol[i];
                        if (inside(nr, nc) && squares[nr][nc].color != us)
                            moves.push_back({r, c, nr, nc});
                    }
                } else if (pt == BISHOP || pt == ROOK || pt == QUEEN) {
                    vector<pair<int,int>> dirs;
                    if (pt == BISHOP || pt == QUEEN) {
                        dirs.push_back({-1,-1}); dirs.push_back({-1,1});
                        dirs.push_back({1,-1});  dirs.push_back({1,1});
                    }
                    if (pt == ROOK || pt == QUEEN) {
                        dirs.push_back({-1,0}); dirs.push_back({1,0});
                        dirs.push_back({0,-1}); dirs.push_back({0,1});
                    }
                    for (auto d : dirs) {
                        int nr = r + d.first, nc = c + d.second;
                        while (inside(nr, nc)) {
                            if (squares[nr][nc].type == EMPTY) {
                                moves.push_back({r, c, nr, nc});
                            } else {
                                if (squares[nr][nc].color == enemy)
                                    moves.push_back({r, c, nr, nc});
                                break;
                            }
                            nr += d.first; nc += d.second;
                        }
                    }
                } else if (pt == KING) {
                    for (int dr = -1; dr <= 1; dr++) {
                        for (int dc = -1; dc <= 1; dc++) {
                            if (dr == 0 && dc == 0) continue;
                            int nr = r + dr, nc = c + dc;
                            if (inside(nr, nc) && squares[nr][nc].color != us)
                                moves.push_back({r, c, nr, nc});
                        }
                    }
                    if (us == WHITE && r == 7 && c == 4) {
                        if (whiteKingSideCastle && squares[7][5].type == EMPTY && squares[7][6].type == EMPTY && squares[7][7].type == ROOK
                            && !isSquareAttacked(7, 4, BLACK) && !isSquareAttacked(7, 5, BLACK) && !isSquareAttacked(7, 6, BLACK)) {
                            Move m = {7, 4, 7, 6}; m.isCastle = true; moves.push_back(m);
                        }
                        if (whiteQueenSideCastle && squares[7][3].type == EMPTY && squares[7][2].type == EMPTY && squares[7][1].type == EMPTY && squares[7][0].type == ROOK
                            && !isSquareAttacked(7, 4, BLACK) && !isSquareAttacked(7, 3, BLACK) && !isSquareAttacked(7, 2, BLACK)) {
                            Move m = {7, 4, 7, 2}; m.isCastle = true; moves.push_back(m);
                        }
                    } else if (us == BLACK && r == 0 && c == 4) {
                        if (blackKingSideCastle && squares[0][5].type == EMPTY && squares[0][6].type == EMPTY && squares[0][7].type == ROOK
                            && !isSquareAttacked(0, 4, WHITE) && !isSquareAttacked(0, 5, WHITE) && !isSquareAttacked(0, 6, WHITE)) {
                            Move m = {0, 4, 0, 6}; m.isCastle = true; moves.push_back(m);
                        }
                        if (blackQueenSideCastle && squares[0][3].type == EMPTY && squares[0][2].type == EMPTY && squares[0][1].type == EMPTY && squares[0][0].type == ROOK
                            && !isSquareAttacked(0, 4, WHITE) && !isSquareAttacked(0, 3, WHITE) && !isSquareAttacked(0, 2, WHITE)) {
                            Move m = {0, 4, 0, 2}; m.isCastle = true; moves.push_back(m);
                        }
                    }
                }
            }
        }
    }

    void generateLegalMoves(vector<Move>& moves) const {
        vector<Move> pseudo;
        generatePseudoLegalMoves(pseudo);
        Color us = sideToMove;
        for (const auto& m : pseudo) {
            Board next;
            makeMove(m, next);
            Color enemy = (us == WHITE) ? BLACK : WHITE;
            if (!next.isKingInCheck(us))
                moves.push_back(m);
        }
    }

    void makeMove(const Move& m, Board& nextBoard) const {
        nextBoard = *this;
        Piece p = nextBoard.squares[m.fromRow][m.fromCol];
        nextBoard.squares[m.fromRow][m.fromCol] = {EMPTY, NONE_COLOR};
        if (m.promotion != EMPTY) p.type = m.promotion;
        nextBoard.squares[m.toRow][m.toCol] = p;
        if (m.isCastle) {
            if (m.toRow == 7 && m.toCol == 6) { nextBoard.squares[7][7] = {EMPTY, NONE_COLOR}; nextBoard.squares[7][5] = {ROOK, WHITE}; }
            else if (m.toRow == 7 && m.toCol == 2) { nextBoard.squares[7][0] = {EMPTY, NONE_COLOR}; nextBoard.squares[7][3] = {ROOK, WHITE}; }
            else if (m.toRow == 0 && m.toCol == 6) { nextBoard.squares[0][7] = {EMPTY, NONE_COLOR}; nextBoard.squares[0][5] = {ROOK, BLACK}; }
            else if (m.toRow == 0 && m.toCol == 2) { nextBoard.squares[0][0] = {EMPTY, NONE_COLOR}; nextBoard.squares[0][3] = {ROOK, BLACK}; }
        }
        if (m.isEnPassant) {
            int epCapturedRow = (sideToMove == WHITE) ? m.toRow + 1 : m.toRow - 1;
            nextBoard.squares[epCapturedRow][m.toCol] = {EMPTY, NONE_COLOR};
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
        if (m.toRow == 7 && m.toCol == 7) nextBoard.whiteKingSideCastle = false;
        if (m.toRow == 7 && m.toCol == 0) nextBoard.whiteQueenSideCastle = false;
        if (m.toRow == 0 && m.toCol == 7) nextBoard.blackKingSideCastle = false;
        if (m.toRow == 0 && m.toCol == 0) nextBoard.blackQueenSideCastle = false;
        nextBoard.sideToMove = (sideToMove == WHITE) ? BLACK : WHITE;
        if (sideToMove == BLACK) nextBoard.fullMoveNumber++;
        nextBoard.computeHash();
    }

    void computeHash() {
        zobristHash = 0;
        static bool initialized = false;
        static uint64_t pieceKeys[2][6][64];
        static uint64_t castleKeys[16];
        static uint64_t epKeys[8];
        static uint64_t sideKey;
        if (!initialized) {
            uint64_t state = 0x123456789ABCDEF0ULL;
            auto rng = [&]() -> uint64_t {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                return state;
            };
            for (int c = 0; c < 2; c++)
                for (int p = 0; p < 6; p++)
                    for (int s = 0; s < 64; s++)
                        pieceKeys[c][p][s] = rng();
            for (int i = 0; i < 16; i++) castleKeys[i] = rng();
            for (int i = 0; i < 8; i++) epKeys[i] = rng();
            sideKey = rng();
            initialized = true;
        }
        for (int r = 0; r < 8; r++) {
            for (int c = 0; c < 8; c++) {
                if (squares[r][c].type != EMPTY) {
                    zobristHash ^= pieceKeys[squares[r][c].color][squares[r][c].type][r * 8 + c];
                }
            }
        }
        int castleIdx = (whiteKingSideCastle?1:0) | (whiteQueenSideCastle?2:0) | (blackKingSideCastle?4:0) | (blackQueenSideCastle?8:0);
        zobristHash ^= castleKeys[castleIdx];
        if (enPassantCol >= 0) zobristHash ^= epKeys[enPassantCol];
        if (sideToMove == BLACK) zobristHash ^= sideKey;
    }

    int evaluate() const {
        int mgScore = 0, egScore = 0;
        int gamePhase = 0;
        static const int phaseValues[] = {0, 1, 1, 2, 4, 0, 0};
        for (int r = 0; r < 8; r++) {
            for (int c = 0; c < 8; c++) {
                Piece p = squares[r][c];
                if (p.type == EMPTY) continue;
                int val = PIECE_VALUES[p.type];
                int rIdx = (p.color == WHITE) ? r : 7 - r;
                int pst = 0;
                switch (p.type) {
                    case PAWN:   pst = PAWN_PST[rIdx][c]; break;
                    case KNIGHT: pst = KNIGHT_PST[rIdx][c]; break;
                    case BISHOP: pst = BISHOP_PST[rIdx][c]; break;
                    case ROOK:   pst = ROOK_PST[rIdx][c]; break;
                    case QUEEN:  pst = QUEEN_PST_MG[rIdx][c]; break;
                    case KING:   pst = KING_PST_MG[rIdx][c]; break;
                    default: break;
                }
                gamePhase += phaseValues[p.type];
                if (p.color == WHITE) { mgScore += val + pst; egScore += val + pst; }
                else { mgScore -= val + pst; egScore -= val + pst; }
            }
        }
        int egKingBonus = 0;
        for (int r = 0; r < 8; r++) {
            for (int c = 0; c < 8; c++) {
                if (squares[r][c].type == KING) {
                    int rIdx = (squares[r][c].color == WHITE) ? r : 7 - r;
                    int bonus = KING_PST_EG[rIdx][c];
                    if (squares[r][c].color == WHITE) egKingBonus += bonus;
                    else egKingBonus -= bonus;
                }
            }
        }
        egScore += egKingBonus;
        gamePhase = min(gamePhase, 24);
        int eval = (mgScore * gamePhase + egScore * (24 - gamePhase)) / 24;
        if (gEvalNoise > 0) {
            uniform_int_distribution<int> jitter(-gEvalNoise, gEvalNoise);
            eval += jitter(rng);
        }
        return (sideToMove == WHITE) ? eval : -eval;
    }
};

static uint64_t zobristTable[2][6][64];
static uint64_t castleZobrist[16];
static uint64_t epZobrist[8];
static uint64_t sideZobrist;

void initZobrist() {
    uint64_t state = 0x123456789ABCDEF0ULL;
    auto rng = [&]() -> uint64_t {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        return state;
    };
    for (int c = 0; c < 2; c++)
        for (int p = 0; p < 6; p++)
            for (int s = 0; s < 64; s++)
                zobristTable[c][p][s] = rng();
    for (int i = 0; i < 16; i++) castleZobrist[i] = rng();
    for (int i = 0; i < 8; i++) epZobrist[i] = rng();
    sideZobrist = rng();
}

struct SearchResult {
    int score;
    Move bestMove;
    long long nodesSearched;
};

const int MAX_DEPTH = 64;

static TTEntry transpositionTable[1 << 20];
static const int TT_SIZE = 1 << 20;
static const int TT_MASK = TT_SIZE - 1;

static Move killerMoves[MAX_DEPTH][2];
static int searchHistory[7][64];
static uint64_t ttHits, ttCutoffs, totalNodes;
static int pruningEvents;

void clearTT() {
    memset(transpositionTable, 0, sizeof(transpositionTable));
}

void clearSearchTables() {
    memset(killerMoves, 0, sizeof(killerMoves));
    memset(searchHistory, 0, sizeof(searchHistory));
    ttHits = 0;
    ttCutoffs = 0;
    totalNodes = 0;
    pruningEvents = 0;
}

inline int squareIndex(int r, int c) { return r * 8 + c; }

Move probeTT(uint64_t hash, int depth, int alpha, int beta, int& score, bool& found) {
    TTEntry& entry = transpositionTable[hash & TT_MASK];
    Move emptyMove = {0, 0, 0, 0};
    found = false;
    if (entry.hash == hash) {
        if (entry.depth >= depth) {
            if (entry.flag == TT_EXACT) {
                score = entry.score;
                found = true;
                ttCutoffs++;
            } else if (entry.flag == TT_ALPHA && entry.score <= alpha) {
                score = entry.score;
                found = true;
                ttCutoffs++;
            } else if (entry.flag == TT_BETA && entry.score >= beta) {
                score = entry.score;
                found = true;
                ttCutoffs++;
            }
        }
        ttHits++;
        return entry.bestMove;
    }
    return emptyMove;
}

void storeTT(uint64_t hash, int depth, int score, int flag, const Move& bestMove) {
    TTEntry& entry = transpositionTable[hash & TT_MASK];
    if (entry.hash != hash || depth >= entry.depth) {
        entry.hash = hash;
        entry.score = score;
        entry.depth = depth;
        entry.flag = flag;
        entry.bestMove = bestMove;
    }
}

inline bool moveEquals(const Move& a, const Move& b) {
    return a.fromRow == b.fromRow && a.fromCol == b.fromCol && a.toRow == b.toRow && a.toCol == b.toCol && a.promotion == b.promotion;
}

int scoreMoveForOrdering(const Board& board, const Move& m, const Move& ttMove, int ply) {
    if (moveEquals(m, ttMove))
        return 10000000;
    Piece target = board.squares[m.toRow][m.toCol];
    Piece attacker = board.squares[m.fromRow][m.fromCol];
    int score = 0;
    if (target.type != EMPTY) {
        score = 1000000 + 10 * PIECE_VALUES[target.type] - PIECE_VALUES[attacker.type];
    } else {
        if (ply < MAX_DEPTH && moveEquals(m, killerMoves[ply][0]))
            score = 900000;
        else if (ply < MAX_DEPTH && moveEquals(m, killerMoves[ply][1]))
            score = 800000;
        else
            score = searchHistory[attacker.type][squareIndex(m.toRow, m.toCol)];
    }
    if (m.promotion == QUEEN) score += 900000;
    else if (m.promotion != EMPTY) score += 800000;
    return score;
}

int quiescence(Board& board, int alpha, int beta, long long& nodeCount, int qDepth) {
    nodeCount++;
    totalNodes++;
    if (qDepth > gMaxQDepth)
        return board.evaluate();
    int standPat = board.evaluate();
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    vector<Move> moves;
    board.generateLegalMoves(moves);
    vector<pair<int, Move>> captures;
    for (const auto& m : moves) {
        if (board.squares[m.toRow][m.toCol].type != EMPTY || m.isEnPassant || m.promotion != EMPTY) {
            int s = 10 * PIECE_VALUES[board.squares[m.toRow][m.toCol].type] - PIECE_VALUES[board.squares[m.fromRow][m.fromCol].type];
            captures.push_back({s, m});
        }
    }
    sort(captures.begin(), captures.end(), [](const pair<int,Move>& a, const pair<int,Move>& b) { return a.first > b.first; });
    for (const auto& item : captures) {
        Board next;
        board.makeMove(item.second, next);
        int score = -quiescence(next, -beta, -alpha, nodeCount, qDepth + 1);
        if (score >= beta) { pruningEvents++; return beta; }
        if (score > alpha) alpha = score;
    }
    return alpha;
}
SearchResult alphabeta(Board& board, int depth, int alpha, int beta, long long& nodeCount, int ply, bool allowCheckExtension) {
    nodeCount++;
    totalNodes++;

    bool inCheck = board.isKingInCheck(board.sideToMove);

    if (depth <= 0 && !inCheck)
        return {quiescence(board, alpha, beta, nodeCount, 0), {0,0,0,0}, nodeCount};

    if (depth <= 0 && inCheck && allowCheckExtension)
        depth = 1;

    vector<Move> moves;
    board.generateLegalMoves(moves);

    if (moves.empty()) {
        if (inCheck) return {-20000 + ply, {0,0,0,0}, nodeCount};
        return {0, {0,0,0,0}, nodeCount};
    }

    int ttScore;
    bool ttFound = false;
    Move ttMove = probeTT(board.zobristHash, depth, alpha, beta, ttScore, ttFound);
    if (ttFound) {
        return {ttScore, ttMove, nodeCount};
    }

    vector<pair<int, Move>> scoredMoves;
    scoredMoves.reserve(moves.size());
    for (const auto& m : moves)
        scoredMoves.push_back({scoreMoveForOrdering(board, m, ttMove, ply), m});
    sort(scoredMoves.begin(), scoredMoves.end(), [](const pair<int,Move>& a, const pair<int,Move>& b) { return a.first > b.first; });

    Move bestMove = scoredMoves[0].second;
    int origAlpha = alpha;
    int bestScore = -1000000;

    for (size_t i = 0; i < scoredMoves.size(); i++) {
        Board next;
        board.makeMove(scoredMoves[i].second, next);
        bool childCheck = next.isKingInCheck(next.sideToMove);
        bool extend = allowCheckExtension && childCheck && depth <= 1;

        SearchResult res = alphabeta(next, depth - 1 + (extend ? 1 : 0), -beta, -alpha, nodeCount, ply + 1, allowCheckExtension && !extend);
        int score = -res.score;

        if (score > bestScore) {
            bestScore = score;
            bestMove = scoredMoves[i].second;
        }
        if (score > alpha) alpha = score;

        if (alpha >= beta) {
            pruningEvents++;
            bool isQuiet = board.squares[scoredMoves[i].second.toRow][scoredMoves[i].second.toCol].type == EMPTY
                        && !scoredMoves[i].second.isEnPassant
                        && scoredMoves[i].second.promotion == EMPTY;
            if (isQuiet && ply < MAX_DEPTH) {
                int piece = board.squares[scoredMoves[i].second.fromRow][scoredMoves[i].second.fromCol].type;
                int toSq = squareIndex(scoredMoves[i].second.toRow, scoredMoves[i].second.toCol);
                searchHistory[piece][toSq] += depth * depth;
                if (!moveEquals(scoredMoves[i].second, killerMoves[ply][0])) {
                    killerMoves[ply][1] = killerMoves[ply][0];
                    killerMoves[ply][0] = scoredMoves[i].second;
                }
            }
            break;
        }
    }

    int flag;
    if (bestScore <= origAlpha) flag = TT_ALPHA;
    else if (bestScore >= beta) flag = TT_BETA;
    else flag = TT_EXACT;

    storeTT(board.zobristHash, depth, bestScore, flag, bestMove);
    return {bestScore, bestMove, nodeCount};
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
    int maxDepth = 4;
    int timeLimitMs = 10000;

    if (argc >= 2) fen = argv[1];
    if (argc >= 3) maxDepth = atoi(argv[2]);
    if (argc >= 4) timeLimitMs = atoi(argv[3]);
    if (argc >= 5) gRandomChance = atoi(argv[4]);
    if (argc >= 6) gEvalNoise = atoi(argv[5]);
    if (argc >= 7) gMaxQDepth = atoi(argv[6]);

    if (maxDepth > 10) maxDepth = 10;

    Board board;
    board.loadFEN(fen);

    auto startTime = chrono::high_resolution_clock::now();
    long long nodeCount = 0;

    clearSearchTables();
    clearTT();

    Move bestMoveSoFar = {0, 0, 0, 0};
    int bestScoreSoFar = 0;
    int actualDepthReached = 0;

    for (int depth = 1; depth <= maxDepth; depth++) {
        long long iterNodes = 0;
        int prevTtHits = ttHits;
        int prevPruning = pruningEvents;
        SearchResult result = alphabeta(board, depth, -1000000, 1000000, iterNodes, 0, true);
        auto currentTime = chrono::high_resolution_clock::now();
        double elapsedMs = chrono::duration<double, milli>(currentTime - startTime).count();
        if (result.bestMove.toUCI().length() >= 4)
            bestMoveSoFar = result.bestMove;
        bestScoreSoFar = result.score;
        actualDepthReached = depth;
        if (elapsedMs > timeLimitMs * 0.6) break;
    }

    auto endTime = chrono::high_resolution_clock::now();
    double totalElapsedMs = chrono::duration<double, milli>(endTime - startTime).count();
    double nps = (totalElapsedMs > 0) ? (totalNodes / (totalElapsedMs / 1000.0)) : 0;

    vector<Move> legalMoves;
    board.generateLegalMoves(legalMoves);

    bool wasRandomBlunder = false;
    if (gRandomChance > 0 && legalMoves.size() > 1 && bestMoveSoFar.toUCI().length() >= 4) {
        uniform_int_distribution<int> coinFlip(1, 100);
        if (coinFlip(rng) <= gRandomChance) {
            Move searchBest = bestMoveSoFar;
            uniform_int_distribution<int> pick(0, (int)legalMoves.size() - 1);
            bestMoveSoFar = legalMoves[pick(rng)];
            if (!(bestMoveSoFar == searchBest)) {
                wasRandomBlunder = true;
                bestScoreSoFar = 0;
            }
        }
    }

    Board nextBoard;
    string nextFEN = fen;
    string bestMoveUCI = "";
    if (bestMoveSoFar.toUCI().length() >= 4) {
        bestMoveUCI = bestMoveSoFar.toUCI();
        board.makeMove(bestMoveSoFar, nextBoard);
        nextFEN = nextBoard.toFEN();
    }

    int totalTtEntries = 0;
    for (int i = 0; i < TT_SIZE; i++)
        if (transpositionTable[i].hash != 0) totalTtEntries++;

    cout << "{\n";
    cout << "  \"status\": \"success\",\n";
    cout << "  \"best_move\": \"" << bestMoveUCI << "\",\n";
    cout << "  \"eval\": " << bestScoreSoFar << ",\n";
    cout << "  \"depth\": " << actualDepthReached << ",\n";
    cout << "  \"nodes\": " << totalNodes << ",\n";
    cout << "  \"time_ms\": " << totalElapsedMs << ",\n";
    cout << "  \"nps\": " << (long long)nps << ",\n";
    cout << "  \"fen\": \"" << escapeJSON(fen) << "\",\n";
    cout << "  \"next_fen\": \"" << escapeJSON(nextFEN) << "\",\n";
    cout << "  \"trace\": {\n";
    cout << "    \"tt_hits\": " << ttHits << ",\n";
    cout << "    \"tt_cutoffs\": " << ttCutoffs << ",\n";
    cout << "    \"tt_hit_rate\": " << ((ttHits > 0) ? (double)ttCutoffs / ttHits : 0.0) << ",\n";
    cout << "    \"tt_entries\": " << totalTtEntries << ",\n";
    cout << "    \"total_pruning_events\": " << pruningEvents << ",\n";
    cout << "    \"iterative_deepening\": true,\n";
    cout << "    \"max_depth_requested\": " << maxDepth << ",\n";
    cout << "    \"actual_depth_reached\": " << actualDepthReached << ",\n";
    cout << "    \"random_blunder\": " << (wasRandomBlunder ? "true" : "false") << ",\n";
    cout << "    \"random_chance\": " << gRandomChance << ",\n";
    cout << "    \"eval_noise\": " << gEvalNoise << ",\n";
    cout << "    \"quiescence_depth\": " << gMaxQDepth << "\n";
    cout << "  },\n";
    cout << "  \"legal_moves\": [";
    for (size_t i = 0; i < legalMoves.size(); i++) {
        cout << "\"" << legalMoves[i].toUCI() << "\"" << (i + 1 < legalMoves.size() ? ", " : "");
    }
    cout << "]\n";
    cout << "}\n";

    return 0;
}
