#include <bits/stdc++.h>
using namespace std;
 enum Color {WHITE, BLACK ,NONE_COLOR};
 enum PieceType { PAWN,KNIGHT,BISHOP,ROOK,QUEEN,KING,EMPTY};

 struct Piece{
        PieceType type = EMPTY;
        Color color = NONE_COLOR; 
 };
 struct Move {
    int fromrow , fromcol , torow , tocol ;
    PieceType promotion = EMPTY;
    bool isCastle = false;
    bool isEnPassant = false;
 };
 class Board {
    public:
     Piece squares[8][8];
     Color sideToMove = WHITE;
     //Castling rights(initial)
     bool whiteKingSideCastle = true; bool whiteQueenSideCastle = true ;
     bool blackKingSideCastle = true; bool blackQueenSideCastle = true ;

 }