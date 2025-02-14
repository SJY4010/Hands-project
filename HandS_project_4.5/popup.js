document.addEventListener("DOMContentLoaded", () => {
  const startAnalysisButton = document.getElementById("start-analysis-btn");
  const statusMessage = document.getElementById("status-message");
  const slider = document.getElementById("political-slider");
  const percentageLabel = document.getElementById("percentage-label");
  const applySliderButton = document.getElementById("apply-slider-btn");

  // ------------------------
  // 1) 팝업 로드 시 슬라이더 값 복원
  // ------------------------
  chrome.storage.local.get("lastSliderValue", (res) => {
    let storedValue = res.lastSliderValue;
    if (typeof storedValue !== "number") {
      storedValue = 50; // 저장된 값이 없으면 50%로 기본
    }
    slider.value = storedValue;
    updateSliderLabel(storedValue);
  });

  // ------------------------
  // 2) 슬라이더 움직일 때 5단위 반올림 & 라벨 갱신
  // ------------------------
  slider.addEventListener("input", () => {
    let sliderValue = Math.round(slider.value / 5) * 5;
    slider.value = sliderValue;
    updateSliderLabel(sliderValue);
  });

  // ------------------------
  // 3) 분석 시작 버튼
  // ------------------------
  startAnalysisButton.addEventListener("click", () => {
    // 현재 분석 상태 확인
    chrome.storage.local.get("analysisState", (res) => {
      const state = res.analysisState || {};
      if (state.status === "in_progress") {
        console.log("분석이 이미 진행 중입니다. 중복 실행 방지.");
        if (statusMessage) statusMessage.textContent = "분석이 이미 진행 중입니다.";
        return;
      }
  
      if (statusMessage) statusMessage.textContent = "분석 중...";
  
      // background.js로 메시지 전송
      chrome.runtime.sendMessage({ action: "startAnalysis" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Message error:", chrome.runtime.lastError.message);
          if (statusMessage) statusMessage.textContent = "분석 실패: 오류 발생";
          return;
        }
  
        // 성공적으로 분석 완료
        if (response?.status === "completed") {
          updateUIFromStorage(); // UI 업데이트
        } else if (response?.status === "failed") {
          if (statusMessage) {
            statusMessage.textContent = `분석 실패: ${response.error || "알 수 없는 오류"}`;
          }
        } else {
          if (statusMessage) {
            statusMessage.textContent = "분석 실패: 알 수 없는 상태";
          }
        }
      });
    });
  });

  // ------------------------
  // 4) '슬라이드 적용' 버튼 (재배열)
  // ------------------------
  applySliderButton.addEventListener("click", () => {
    const conservativePercentage = parseInt(slider.value, 10); // 보수 비율
    const progressivePercentage = 100 - conservativePercentage; // 진보 비율

    // (1) 슬라이더 값 local storage 저장
    chrome.storage.local.set({ lastSliderValue: conservativePercentage });

    // (2) background.js → content.js로 재배열 메시지
    chrome.runtime.sendMessage(
      {
        action: "applyRearrangement",
        conservative: conservativePercentage,
        progressive: progressivePercentage,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("[popup.js] Failed to send message:", chrome.runtime.lastError.message);
          if (statusMessage) statusMessage.textContent = "재배열 실패(전송 오류)";
          return;
        }
        if (response && response.success) {
          // content.js가 성공적으로 재배열 후 응답을 준 경우
          if (statusMessage) statusMessage.textContent = "재배열 완료";
        } else {
          if (statusMessage) statusMessage.textContent = "재배열 실패";
        }
      }
    );
  });

  // ------------------------
  // 5) 초기 UI 상태 동기화
  // ------------------------
  updateUIFromStorage();

  // ------------------------
  // 6) 스토리지 변경 감지하여 UI 업데이트
  // ------------------------
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.analysisState) {
      console.log("스토리지 상태 변경 감지:", changes.analysisState.newValue);
      updateUIFromStorage();
    }
  });

  // -------------------------------------------------
  // UI 업데이트 함수 (analysisState 가져와서 표시)
  // -------------------------------------------------
  function updateUIFromStorage() {
    chrome.storage.local.get("analysisState", (res) => {
      const state = res.analysisState || {
        status: "reload",
        jinbo: 50,
        bosu: 50,
        jinboCount: 0,
        bosuCount: 0,
        neutralCount: 0,
        error: null,
      };

      const { status, jinbo, bosu, jinboCount, bosuCount, neutralCount } = state;

      if (statusMessage) {
        switch (status) {
          case "reload":
            statusMessage.textContent = "크롤링 중...";
            break;
          case "ready":
            statusMessage.textContent = "분석 준비 완료";
            break;
          case "in_progress":
            statusMessage.textContent = "분석 중...";
            break;
          case "completed":
            statusMessage.textContent = "분석 완료";
            console.log(`진보: ${jinboCount}개, 보수: ${bosuCount}개, 상관없음: ${neutralCount}개`);
            // ✅ 분석 완료 후 content.js에 테두리 적용 메시지 전송
            chrome.runtime.sendMessage({ action: "analysisCompleted" });

            break;
          case "failed":
            statusMessage.textContent = `분석 실패: ${state.error || "알 수 없는 오류"}`;
            break;
          default:
            statusMessage.textContent = "상태를 알 수 없습니다";
        }
      }

      // 스토리지에 저장된 bosu/jinbo로 슬라이더 & 라벨 동기화
      if (slider) slider.value = bosu;
      updateSliderLabel(bosu);
    });
  }

  // -------------------------------------------------
  // 슬라이더 레이블 갱신 헬퍼 함수
  // -------------------------------------------------
  function updateSliderLabel(value) {
    const conservative = parseInt(value, 10);
    const progressive = 100 - conservative;
    if (percentageLabel) {
      percentageLabel.textContent = `보수: ${conservative}%, 진보: ${progressive}%`;
    }
  }
});
