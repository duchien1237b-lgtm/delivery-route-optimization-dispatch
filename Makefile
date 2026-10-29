# Build nhanh bằng g++ (Linux, macOS, Windows MSYS2/MinGW-w64)
#   make          -> tạo file chạy ./delivery
#   make run      -> chạy web server tại http://localhost:8080 (dữ liệu ở .run-data/)
#   make reset    -> xoá .run-data/ để về dữ liệu mẫu ban đầu
#   make test     -> chạy toàn bộ kiểm thử
#   make clean
CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra
CPPFLAGS += -Isrc -Ithird_party
LDLIBS   += -pthread

ifeq ($(OS),Windows_NT)
  EXE      := .exe
  CPPFLAGS += -D_WIN32_WINNT=0x0A00
  LDLIBS   += -lws2_32
endif

CORE   := src/Graph.cpp src/Traversal.cpp src/FileIO.cpp src/ShortestPath.cpp \
          src/BellmanFord.cpp src/Estimator.cpp src/Dispatcher.cpp src/Operations.cpp src/Trie.cpp src/Trace.cpp src/Analysis.cpp src/Pricing.cpp src/Auth.cpp \
          src/Commerce.cpp src/Support.cpp src/OrderFlow.cpp src/Billing.cpp
OBJDIR := build/obj
CORE_O := $(CORE:src/%.cpp=$(OBJDIR)/%.o)
HDRS   := $(wildcard src/*.h src/*.inc)

all: delivery$(EXE)

$(OBJDIR)/%.o: src/%.cpp $(HDRS)
	@mkdir -p $(OBJDIR)
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) -c $< -o $@

delivery$(EXE): $(CORE_O) $(OBJDIR)/main.o $(OBJDIR)/WebServer.o
	$(CXX) $(CXXFLAGS) $^ -o $@ $(LDLIBS)

test_traversal$(EXE): $(CORE_O) tests/test_traversal_fileio.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $^ -o $@ $(LDLIBS)

test_algorithms$(EXE): $(CORE_O) tests/test_algorithms.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $^ -o $@ $(LDLIBS)

test_features$(EXE): $(CORE_O) tests/test_features.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $^ -o $@ $(LDLIBS)

test_extensions$(EXE): $(CORE_O) tests/test_extensions.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $^ -o $@ $(LDLIBS)

test_business$(EXE): $(CORE_O) tests/test_business.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $^ -o $@ $(LDLIBS)

test_auth$(EXE): $(CORE_O) tests/test_auth.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $^ -o $@ $(LDLIBS)

test_commerce$(EXE): $(CORE_O) tests/test_commerce.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $^ -o $@ $(LDLIBS)

test_web$(EXE): $(CORE_O) $(OBJDIR)/WebServer.o tests/test_web.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $^ -o $@ $(LDLIBS)

# Chạy trên bản sao của data/ (.run-data/) để dữ liệu mẫu trong git luôn sạch. Làm lại từ đầu: make reset
run: delivery$(EXE)
	@[ -d .run-data ] || cp -r data .run-data
	./delivery$(EXE) --data .run-data

reset:
	rm -rf .run-data

console: delivery$(EXE)
	./delivery$(EXE) --console

test: test_traversal$(EXE) test_algorithms$(EXE) test_features$(EXE) test_extensions$(EXE) test_business$(EXE) test_auth$(EXE) test_commerce$(EXE) test_web$(EXE)
	./test_traversal$(EXE)
	./test_algorithms$(EXE)
	./test_features$(EXE)
	./test_extensions$(EXE)
	./test_business$(EXE)
	./test_auth$(EXE)
	./test_commerce$(EXE)
	./test_web$(EXE)

# So khớp bản một file (engine JavaScript) với server C++ trên cùng kịch bản API (cần Node.js)
diff-standalone: delivery$(EXE)
	node tools/diff_standalone.mjs

clean:
	rm -rf build delivery$(EXE) test_traversal$(EXE) test_algorithms$(EXE) test_features$(EXE) test_extensions$(EXE) test_business$(EXE) test_auth$(EXE) test_commerce$(EXE) test_web$(EXE) out_map.txt out_orders.txt

.PHONY: all run reset console test diff-standalone clean
