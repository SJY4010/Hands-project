function collectVideoIds() {
  const links = document.querySelectorAll('a[href*="watch?v="]');
  const videoIds = new Set();

  links.forEach((link) => {
    try {
      const url = new URL(link.href);
      const vParam = url.searchParams.get("v");
      if (vParam) {
        videoIds.add(vParam);
      }
    } catch (err) {
      // URL 파싱 실패 시 무시
    }
  });
  return Array.from(videoIds);
}

function sendVideoIdsToBackground() {
  scrollAndCollectVideoIds(100).then((ids) => {
    console.log("[content.js] Collected video IDs:", ids);

    chrome.runtime.sendMessage(
      {
        action: "collectedVideoIds",
        videoIds: ids,
      },
      (response) => {
        const statusMessage = document.getElementById("status-message");
        if (response?.status === "ready") {
          console.log("[content.js] 크롤링 후 상태 업데이트 성공:", response);
          if (statusMessage) statusMessage.textContent = "분석 준비 완료";
        } else {
          console.error("크롤링 후 상태 업데이트 실패:", response);
          if (statusMessage) statusMessage.textContent = "상태 업데이트 실패";
        }
      }
    );
  });
}

async function scrollAndCollectVideoIds(targetCount = 100) {
  let videoIds = new Set();

  while (videoIds.size < targetCount) {
    // 현재 수집된 ID 갯수 확인
    videoIds = new Set([...videoIds, ...collectVideoIds()]);

    // 목표치에 도달하면 스크롤 중단
    if (videoIds.size >= targetCount) {
      break;
    }

    // 스크롤 아래로
    window.scrollBy(0, window.innerHeight);

    // 로딩 대기 (1초)
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // 스크롤 맨 위로 이동
  window.scrollTo(0, 0);

  // 상태 메시지 업데이트: 크롤링 완료 후
  const statusMessage = document.getElementById("status-message");
  if (statusMessage) statusMessage.textContent = "분석 준비 완료";

  return Array.from(videoIds);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {   // (3-2) backgrond에서 온 message 받음음

  if (message.action === "applyRearrangement") { 
    console.log("[content.js] applyRearrangment received : ", message);   // (3-2) background에서 온 message가 정확한지 확인.
    rearrangeVideos(message.conservative, message.details, message.progressive);
    sendResponse({ success: true });
  }

  // ✅ 분석이 완료된 후 자동으로 테두리를 적용하는 코드 추가
  if (message.action === "analysisCompleted") {
    console.log("[content.js] 받아온 analysisdetails : ", message.details);   //가끔 없음. 판단불가 100개 오류류
    console.log("[content.js] 분석 완료 - 영상 테두리 적용 시작");
    applyVideoBorders(message.details);
    sendResponse({ success: true });
  }
});

function applyVideoBorders(details) {
  console.log("[content.js] 영상 테두리 적용 시작");

  details.forEach((video) => {
    const videoElement = document.querySelector(`[href*="watch?v=${video.videoId}"]`)?.closest("ytd-rich-item-renderer");

    if (videoElement) {
      // 기존 테두리 제거
      videoElement.classList.remove("jinbo-border", "bosu-border", "neutral-border");

      // 새로운 스타일 적용
      if (video.orientation === "진보") {
        videoElement.classList.add("jinbo-border");
      } else if (video.orientation === "보수") {
        videoElement.classList.add("bosu-border");
      } else {
        videoElement.classList.add("neutral-border");
      }
    }
  });

  console.log("[content.js] 영상 테두리 적용 완료");
}


function shuffleArray(array) {
  let shuffled = array.slice(); // 원본 배열 복사
  for (let i = shuffled.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1)); // 0부터 i 사이의 랜덤 인덱스
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; // Swap
  }
  return shuffled;
}


// (3-3) rearrangeVideos 함수로 비율 & detail 도착 
async function rearrangeVideos(conservative, details, progressive) {
  console.log("[content.js] 대기 중: background.js에서 재배열 정보 수신");


  console.log("[content.js] rearrangeVideos 함수에서 받은 정보 :", details);

  await new Promise((resolve) => {
    if(details.length == 100){
      console.log("details 로딩 완료",details);
      resolve()
    }
  });
  
  console.log("[content.js] 시작: 재배열 실행");   //여기까지 굳굳굳왕굳굳굳굳

  // 1️. 유튜브 홈 화면에서 모든 영상 요소 가져오기
  const videoElements = Array.from(document.querySelectorAll("ytd-rich-item-renderer"));
  let contentContainer = videoElements[0]?.parentNode;
  if (!contentContainer) {
    console.error("[content.js] 유튜브 홈 컨테이너를 찾을 수 없습니다.");
    return;
  }

  console.log(`[content.js] 기존 영상 개수: ${videoElements.length}`);

  // 2️. `details`를 기반으로 정치 성향별 영상 분류 (판단불가 제거)
  let progressiveVideos = details.filter((item) => item.orientation === "진보");
  let conservativeVideos = details.filter((item) => item.orientation === "보수");

  console.log(`[content.js] 진보: ${progressiveVideos.length}, 보수: ${conservativeVideos.length}`);

  // 3️. 비율에 맞게 재배열할 개수 설정
  let progressiveCount = Math.round((progressive / 100) * 100);
  let conservativeCount = 100 - progressiveCount;

  console.log(`[content.js] 최종 진보: ${progressiveCount}, 보수: ${conservativeCount}`);

  // 전역에서 `arrangedVideos` 선언하여 어디서든 접근 가능하게 변경
  let arrangedVideos = [];

  // 4. 개수 초과 시 삭제 (필요 개수만 남기기)
  progressiveVideos = progressiveVideos.slice(0, progressiveCount).filter(Boolean);
  conservativeVideos = conservativeVideos.slice(0, conservativeCount).filter(Boolean);

  console.log(`[content.js] 초과분 삭제하고 남은 진보 영상 개수: ${progressiveVideos.length}`);
  console.log(`[content.js] 초과분 삭제하고 남은 보수 영상 개수: ${conservativeVideos.length}`);


  // 5️. 영상 개수가 부족할 경우 background.js에서 추가 영상 가져오기
  const response = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "getBackupVideos" }, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(res);
      }
    });
  });

  console.log(`[content.js] 백그라운드에서 받아온 추가 진보 영상 개수: ${progressiveCount-progressiveVideos.length}`);
  console.log(`[content.js] 백그라운드에서 받아온 추가 보수 영상 개수: ${conservativeCount-conservativeVideos.length}`);

  // ✅ 부족한 진보 영상 보충 (배열이 비어있지 않은지 확인)
  if (Array.isArray(response.progressiveVideos) && response.progressiveVideos.length > 0) {
    const needed = progressiveCount - progressiveVideos.length;
    let additionalVideos = response.progressiveVideos.slice(0, needed).map(videoId => ({
      videoId,
      orientation: "진보"
    }));
    progressiveVideos = [...progressiveVideos, ...additionalVideos];
  }

  // ✅ 부족한 보수 영상 보충 (배열이 비어있지 않은지 확인)
  if (Array.isArray(response.conservativeVideos) && response.conservativeVideos.length > 0) {
    const needed = conservativeCount - conservativeVideos.length;
    let additionalVideos = response.conservativeVideos.slice(0, needed).map(videoId => ({
      videoId,
      orientation: "보수"
    }));
    conservativeVideos = [...conservativeVideos, ...additionalVideos];
  }

  arrangedVideos = [...progressiveVideos, ...conservativeVideos];

  // 6. 부족한 영상이 있으면 `while` 문으로 보충
  while (arrangedVideos.length < 100) {
    if (progressiveVideos.length > conservativeVideos.length) {
      arrangedVideos.push(progressiveVideos.pop());
    } else if (conservativeVideos.length > 0) {
      arrangedVideos.push(conservativeVideos.pop());
    } else {
      console.warn("[content.js] 추가할 보수/진보 영상이 부족하여 100개를 채우지 못함.");
      break;
    }
  }

  arrangedVideos = shuffleArray(arrangedVideos);

  console.log(`[content.js] 최종 arrangedVideos 개수: ${arrangedVideos.length}`);

  if (arrangedVideos.length < 100) {
    console.warn(`[content.js] 최종 영상 개수가 부족합니다! (${arrangedVideos.length}/100)`);
  }

  // 7. 기존 DOM 정리
  contentContainer.innerHTML = "";
  
  console.log("arrangedVideos DOM 정리 전 : ", arrangedVideos);

  async function fetchVideoDetails(videoIds) {
    const apiKey = "youtube api keeee"; // background.js에서 정의된 API 키 사용
    let videoDetails = {};
  
    // API 호출은 한 번에 50개씩 요청 가능
    const chunkSize = 50;
    for (let i = 0; i < videoIds.length; i += chunkSize) {
      const chunk = videoIds.slice(i, i + chunkSize);
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${chunk.join(",")}&key=${apiKey}`;
  
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`[fetchVideoDetails] API 요청 실패: ${response.status}`);
        }
        const data = await response.json();
  
        if (!data.items || data.items.length === 0) {
          console.warn(`[fetchVideoDetails] API 응답에 영상 정보가 없습니다. 요청된 ID: ${chunk.join(",")}`);
          continue;
        }
  
        // 받아온 데이터 저장
        data.items.forEach((item) => {
          videoDetails[item.id] = {
            title: item.snippet?.title || "제목 없음",
            channelName: item.snippet?.channelTitle || "알 수 없음",
            views: item.statistics?.viewCount ? Number(item.statistics.viewCount).toLocaleString() + "회" : "조회수 없음",
            duration: item.contentDetails?.duration || "길이 없음",
            channelId: item.snippet?.channelId || "채널 ID 없음",
            uploadTime: item.snippet?.publishedAt || "업로드 날짜 없음",
          };
        });
      } catch (error) {
        console.error(`[fetchVideoDetails] 유튜브 API 호출 실패: ${error.message}`);
      }
    }
  
    // 📌 추가 요청: 채널 이미지 가져오기
    videoDetails = await fetchChannelImages(videoDetails, apiKey);
    return videoDetails;
  }
  
  async function fetchChannelImages(videoDetails, apiKey) {
    const channelIds = [...new Set(Object.values(videoDetails).map(video => video.channelId))];
    let channelImages = {};
  
    for (let i = 0; i < channelIds.length; i += 50) {
      const chunk = channelIds.slice(i, i + 50);
      const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${chunk.join(",")}&key=${apiKey}`;
  
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`[fetchChannelImages] API 요청 실패: ${response.status}`);
        }
        const data = await response.json();
  
        if (data.items) {
          data.items.forEach((channel) => {
            channelImages[channel.id] = channel.snippet?.thumbnails?.default?.url || "";
          });
        }
      } catch (error) {
        console.error(`[fetchChannelImages] 유튜브 API 호출 실패: ${error.message}`);
      }
    }
  
    // 📌 영상 정보에 채널 이미지 추가
    Object.values(videoDetails).forEach(video => {
      video.channelImage = channelImages[video.channelId] || "이미지 없음";
    });
  
    return videoDetails;
  }
  
  // 7. 기존 영상 정보 정리 완료 후, 추가적인 정보 가져오기
  const videoIds = arrangedVideos.map(video => video.videoId);
  const videoInfo = await fetchVideoDetails(videoIds);
  
  // 8. 새로 배열된 영상 추가하기 전에 `arrangedVideos` 객체 업데이트
  arrangedVideos = arrangedVideos.map(video => ({
    ...video,
    title: videoInfo[video.videoId]?.title || "제목 없음",
    channelName: videoInfo[video.videoId]?.channelName || "알 수 없음",
    views: videoInfo[video.videoId]?.views || "조회수 없음",
    duration: videoInfo[video.videoId]?.duration || "길이 없음",
    channelId: videoInfo[video.videoId]?.channelId || "채널 ID 없음",
    uploadTime: videoInfo[video.videoId]?.uploadTime || "업로드 날짜 없음",
    channelImage: videoInfo[video.videoId]?.channelImage || "이미지 없음",
  }));
  
  

  console.log("arrangedVideos DOM 정리 후 : ", arrangedVideos);


  // 8. 새로운 배열된 영상 추가
  arrangedVideos.forEach((video) => {
    // 새로운 유튜브 영상 아이템 생성
    let newElement = document.createElement("div");
    newElement.classList.add("youtube-video-card");

    // 제목을 두 줄까지만 표시하는 함수 추가
    function truncateTitle(title, maxLength = 80) {
      if (title.length > maxLength) {
        return title.substring(0, maxLength) + "...";
      }
      return title;
    }

    // 내부 컨텐츠 생성
    newElement.innerHTML = `
      <div class="video-card">
        <a href="https://www.youtube.com/watch?v=${video.videoId}" class="thumbnail">
          <img src="https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg" alt="${video.title}" />
          <span class="duration">${video.duration}</span>
        </a>
        <div class="video-info">
          <div class="channel-container">
            <img src="${video.channelImage}" alt="${video.channelName}" class="channel-image" />
          </div>
          <div class="text-info">
            <h3 class="title">${truncateTitle(video.title)}</h3>
            <span class="channel">${video.channelName}</span>
            <span class="views">조회수 ${video.views}회</span>
          </div>
        </div>
      </div>
    `;
  
    // 정치 성향에 따른 테두리 스타일 적용
    if (video.orientation === "진보") {
      newElement.classList.add("jinbo-border");
    } else if (video.orientation === "보수") {
      newElement.classList.add("bosu-border");
    } else {
      newElement.classList.add("neutral-border");
    }

    // 컨테이너에 추가
    contentContainer.appendChild(newElement);
    console.log(`[content.js] 추가된 영상: ${video.videoId}`);
  });



  // 9. 스크롤 맨 위로 이동
  window.scrollTo({ top: 0, behavior: "smooth" });

  console.log("[content.js] 영상 재배열 완료 및 화면 초기화");

  
}


// 유튜브 페이지 로드 후 자동 실행
window.addEventListener("load", () => {
  chrome.runtime.sendMessage({ action: "pageReloaded" });
  setTimeout(() => {
    const statusMessage = document.getElementById("status-message");
    if (statusMessage) statusMessage.textContent = "크롤링 중...";
    sendVideoIdsToBackground();
  }, 4000);
});


