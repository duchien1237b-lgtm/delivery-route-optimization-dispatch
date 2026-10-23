CXX      = g++
CXXFLAGS = -std=c++17 -O2 -Wall -Wextra
SRC      = main.cpp dispatcher.cpp io.cpp
TARGET   = dispatch

all: $(TARGET)

$(TARGET): $(SRC) types.h dispatcher.h io.h
	$(CXX) $(CXXFLAGS) -o $@ $(SRC)

run: $(TARGET)
	./$(TARGET) input.txt output.txt

clean:
	rm -f $(TARGET) output.txt
